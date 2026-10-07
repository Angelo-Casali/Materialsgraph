from materialsgraph.harvest.aliases import lookup_formula_alias, lookup_molecule
from materialsgraph.harvest.resolve import resolve_formula


def test_alias_tables():
    assert lookup_formula_alias("LLZO") == "Li7La3Zr2O12"
    assert lookup_formula_alias("nmc811") == "LiNi0.8Mn0.1Co0.1O2"
    assert lookup_formula_alias("unknownium") is None
    assert lookup_molecule("ethylene carbonate")["common_name"] == "EC"
    assert lookup_molecule("LiPF6")["roles"] == ["electrolyte salt"]


def test_resolve_without_graph_gives_lit_stub():
    res = resolve_formula("FeLiO4P")
    assert res.status == "new_crystal"
    assert res.material_key == "lit:LiFePO4"
    assert res.reduced_formula == "LiFePO4"
    assert res.composition["O"] == 4.0


def test_resolve_alias_then_parse():
    res = resolve_formula("LLZO")
    assert res.reduced_formula == "Li7La3Zr2O12"


def test_resolve_molecule():
    res = resolve_formula("EC")
    assert res.status == "new_molecule"
    assert res.kind == "molecule"
    assert res.material_key.startswith("mol:")
    assert res.common_name == "EC"


def test_resolve_variable_and_garbage():
    assert resolve_formula("Li1-xCoO2").status == "unresolved_variable"
    assert resolve_formula("!!!").status == "unparseable"
    assert resolve_formula("").status == "unparseable"


class _FakeSession:
    """Minimal stand-in: answers find_materials_by_formula and the doped-variant query."""

    def __init__(self, polymorphs, neighbours=()):
        self.polymorphs = polymorphs
        self.neighbours = list(neighbours)

    def run(self, query, **params):
        class R(list):
            def single(self):
                return self[0] if self else None

        if "reduced_formula: $rf" in query:
            return R(self.polymorphs if params["rf"] in {p["reduced_formula"] for p in self.polymorphs} else [])
        if "COMPOSED_OF" in query:
            return R(self.neighbours)
        return R()


def test_resolve_matched_single_polymorph():
    s = _FakeSession([{"material_key": "mp:mp-1", "formula": "LiFePO4", "reduced_formula": "LiFePO4", "spacegroup": "Pnma", "spacegroup_number": 62, "kind": "crystal", "energy_above_hull": 0.0}])
    res = resolve_formula("LiFePO4", s)
    assert res.status == "matched" and res.material_key == "mp:mp-1"


def test_resolve_ambiguous_polymorphs_defaults_to_first():
    s = _FakeSession([
        {"material_key": "mp:a", "formula": "LiCoO2", "reduced_formula": "LiCoO2", "spacegroup": "R-3m", "spacegroup_number": 166, "kind": "crystal", "energy_above_hull": 0.0},
        {"material_key": "mp:b", "formula": "LiCoO2", "reduced_formula": "LiCoO2", "spacegroup": "Fd-3m", "spacegroup_number": 227, "kind": "crystal", "energy_above_hull": 0.02},
    ])
    res = resolve_formula("LiCoO2", s)
    assert res.status == "ambiguous" and res.material_key == "mp:a" and res.candidates == ["mp:a", "mp:b"]
    assert resolve_formula("LiCoO2", s, spacegroup="Fd-3m").material_key == "mp:b"


def test_resolve_doped_variant_links_parent():
    parent_comp = [{"symbol": "Li", "amt": 7}, {"symbol": "La", "amt": 3}, {"symbol": "Zr", "amt": 2}, {"symbol": "O", "amt": 12}]
    s = _FakeSession([], neighbours=[{"material_key": "mp:llzo", "formula": "Li7La3Zr2O12", "comp": parent_comp}])
    res = resolve_formula("Li6.4La3Zr1.4Ta0.6O12", s)
    assert res.status == "doped_variant"
    assert res.parent_material_key == "mp:llzo"
    assert res.material_key == "lit:Li6.4La3Zr1.4Ta0.6O12"
    assert res.parent_score > 0.9
