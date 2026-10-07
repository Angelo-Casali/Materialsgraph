"""Hand-curated ILLUSTRATIVE sample for the showcase website.

Approximate, commonly reported textbook/review-level values for well-known
battery materials, so the site has something real-looking to explore before
the user exports their own graph (`mg export site`).

Honesty rules for this file:
- every value cites the single non-citable source `sample:illustrative`;
- no Materials Project ids, no DOIs, no statements attributed to a paper;
- keys live in the `sample:` namespace so the sample can never merge with
  real nodes, and `mg site purge-sample` removes it cleanly;
- source_type says what *kind* of number it is (dft for band gap /
  energy above hull, measured for lab quantities); conditions say which
  phase/temperature the number refers to. These are rounded, typical values,
  not the output of a specific calculation or experiment.
"""

from __future__ import annotations

NOTICE = (
    "Illustrative sample: rounded, commonly reported values for well-known battery materials, "
    "hand-curated to demonstrate the atlas. Not for citation. Replace with your own graph via `mg export site`."
)

SAMPLE_SOURCE = {
    "source_id": "sample:illustrative",
    "title": "MaterialsGraph illustrative sample (hand-curated, approximate, not for citation)",
    "type": "database",
    "license": "illustrative-not-for-citation",
    "citable": False,
}

RT = '{"temperature_K": 298}'

# Each property tuple: (property_type, value, source_type, conditions, confirmed, note)
# Each used_in tuple: (application, basis, confirmed)
CRYSTALS: list[dict] = [
    # ---------------- cathodes ----------------
    {
        "formula": "LiFePO4", "common_name": "LFP", "structure_type": "olivine", "spacegroup": "Pnma",
        "blurb": "Olivine cathode: modest voltage, outstanding safety and cycle life, no cobalt or nickel.",
        "properties": [
            ("voltage", 3.45, "measured", "", True, "flat plateau vs Li/Li+"),
            ("specific_capacity", 160, "measured", '{"rate": "C/10"}', True, "practical; ~170 theoretical"),
            ("band_gap", 3.7, "dft", '{"functional": "GGA+U"}', True, None),
            ("energy_above_hull", 0.0, "dft", "", True, "ground state"),
        ],
        "used_in": [("Li-ion cathode", "curated", True)],
    },
    {
        "formula": "LiCoO2", "common_name": "LCO", "structure_type": "layered (α-NaFeO2)", "spacegroup": "R-3m",
        "blurb": "The original commercial Li-ion cathode; cobalt-heavy.",
        "properties": [
            ("voltage", 3.9, "measured", "", True, None),
            ("specific_capacity", 140, "measured", '{"cutoff_V": 4.2}', True, "about half the Li is cycled"),
            ("band_gap", 2.7, "dft", '{"functional": "GGA+U"}', True, None),
            ("energy_above_hull", 0.0, "dft", "", True, None),
        ],
        "used_in": [("Li-ion cathode", "curated", True)],
    },
    {
        "formula": "LiNi0.8Mn0.1Co0.1O2", "common_name": "NMC811", "structure_type": "layered", "spacegroup": "R-3m",
        "blurb": "High-nickel layered oxide: high capacity, less cobalt, harder to stabilise.",
        "properties": [
            ("voltage", 3.8, "measured", "", True, None),
            ("specific_capacity", 200, "measured", '{"cutoff_V": 4.3}', True, None),
            ("cycling_stability", 85, "measured", '{"cycles": 500}', True, "typical full-cell retention, varies widely"),
        ],
        "used_in": [("Li-ion cathode", "curated", True)],
    },
    {
        "formula": "LiNi0.8Co0.15Al0.05O2", "common_name": "NCA", "structure_type": "layered", "spacegroup": "R-3m",
        "blurb": "Nickel-cobalt-aluminium layered oxide used in long-range EV cells.",
        "properties": [
            ("voltage", 3.7, "measured", "", True, None),
            ("specific_capacity", 190, "measured", "", True, None),
        ],
        "used_in": [("Li-ion cathode", "curated", True)],
    },
    {
        "formula": "LiMn2O4", "common_name": "LMO", "structure_type": "spinel", "spacegroup": "Fd-3m",
        "blurb": "Manganese spinel: cheap and fast, but capacity fades at elevated temperature.",
        "properties": [
            ("voltage", 4.0, "measured", "", True, None),
            ("specific_capacity", 120, "measured", "", True, "~148 theoretical"),
            ("energy_above_hull", 0.0, "dft", "", True, None),
        ],
        "used_in": [("Li-ion cathode", "curated", True)],
    },
    {
        "formula": "LiNi0.5Mn1.5O4", "common_name": "LNMO", "structure_type": "spinel", "spacegroup": "P4_332",
        "blurb": "High-voltage cobalt-free spinel; needs electrolytes that survive ~4.7 V.",
        "properties": [
            ("voltage", 4.7, "measured", "", True, None),
            ("specific_capacity", 135, "measured", "", True, None),
        ],
        "used_in": [("Li-ion cathode", "curated", True)],
    },
    {
        "formula": "LiMnPO4", "common_name": "LMP", "structure_type": "olivine", "spacegroup": "Pnma",
        "blurb": "Higher-voltage cousin of LFP, held back by poor electronic conductivity.",
        "properties": [
            ("voltage", 4.1, "measured", "", True, None),
            ("specific_capacity", 145, "measured", '{"form": "carbon-coated nanoparticles"}', True, None),
        ],
        # demonstrates the review gate: an extracted tag awaiting a human decision
        "used_in": [("Li-ion cathode", "literature", False)],
    },
    # ---------------- Na-ion ----------------
    {
        "formula": "Na3V2(PO4)3", "common_name": "NVP", "structure_type": "NASICON", "spacegroup": "R-3c",
        "blurb": "NASICON-type sodium cathode with a flat 3.4 V plateau.",
        "properties": [
            ("voltage", 3.4, "measured", '{"reference": "Na/Na+"}', True, None),
            ("specific_capacity", 110, "measured", "", True, "~117 theoretical"),
        ],
        "used_in": [("Na-ion cathode", "curated", True)],
    },
    {
        "formula": "Na0.67Ni0.33Mn0.67O2", "common_name": "P2-NNM", "structure_type": "P2 layered", "spacegroup": "P6_3/mmc",
        "blurb": "P2-type layered sodium oxide, nickel-manganese, cobalt-free.",
        "properties": [
            ("voltage", 3.6, "measured", '{"reference": "Na/Na+"}', True, None),
            ("specific_capacity", 150, "measured", '{"window_V": "2.0-4.3"}', True, None),
        ],
        "used_in": [("Na-ion cathode", "literature", False)],
    },
    # ---------------- anodes ----------------
    {
        "formula": "Li4Ti5O12", "common_name": "LTO", "structure_type": "spinel", "spacegroup": "Fd-3m",
        "blurb": "Zero-strain titanate anode: very long life, low energy (high voltage vs Li).",
        "properties": [
            ("voltage", 1.55, "measured", "", True, None),
            ("specific_capacity", 165, "measured", "", True, "~175 theoretical"),
            ("cycling_stability", 95, "measured", '{"cycles": 5000}', True, None),
        ],
        "used_in": [("anode material", "curated", True)],
    },
    {
        "formula": "C", "common_name": "graphite", "structure_type": "graphite", "spacegroup": "P6_3/mmc",
        "blurb": "The workhorse anode, intercalating Li to LiC6.",
        "properties": [
            ("voltage", 0.1, "measured", "", True, None),
            ("specific_capacity", 360, "measured", "", True, "372 theoretical (LiC6)"),
        ],
        "used_in": [("anode material", "curated", True)],
    },
    {
        "formula": "Si", "common_name": "silicon", "structure_type": "diamond cubic", "spacegroup": "Fd-3m",
        "blurb": "Alloying anode with ~10x graphite's capacity and ~300% volume swing.",
        "properties": [
            ("voltage", 0.4, "measured", "", True, None),
            ("specific_capacity", 3000, "measured", '{"cycles": "initial"}', True, "~3579 theoretical (Li15Si4); fades fast"),
            ("band_gap", 1.1, "measured", RT, True, "indirect"),
        ],
        "used_in": [("anode material", "curated", True)],
    },
    # ---------------- solid electrolytes ----------------
    {
        "formula": "Li7La3Zr2O12", "common_name": "LLZO", "structure_type": "garnet", "spacegroup": "Ia-3d",
        "blurb": "Garnet oxide electrolyte, stable against Li metal. Conductivity depends dramatically on phase.",
        "properties": [
            ("ionic_conductivity", 1e-6, "measured", '{"phase": "tetragonal", "temperature_K": 298}', True, "undoped, tetragonal"),
            ("ionic_conductivity", 4e-4, "measured", '{"phase": "cubic, Al-doped", "temperature_K": 298}', True, "dopant-stabilised cubic phase"),
            ("band_gap", 6.0, "dft", "", True, None),
        ],
        "used_in": [("solid electrolyte", "curated", True)],
    },
    {
        "formula": "Li10GeP2S12", "common_name": "LGPS", "structure_type": "LGPS-type", "spacegroup": "P4_2/nmc",
        "blurb": "Sulfide superionic conductor rivalling liquid electrolytes; germanium is costly.",
        "properties": [
            ("ionic_conductivity", 1.2e-2, "measured", RT, True, None),
            ("activation_energy", 0.25, "measured", "", True, None),
        ],
        "used_in": [("solid electrolyte", "curated", True)],
    },
    {
        "formula": "Li7P3S11", "common_name": "LPS glass-ceramic", "structure_type": "glass-ceramic", "spacegroup": "P-1",
        "blurb": "Glass-ceramic thiophosphate with liquid-like conductivity, moisture sensitive.",
        "properties": [
            ("ionic_conductivity", 1.7e-2, "measured", RT, True, None),
        ],
        "used_in": [("solid electrolyte", "literature", False)],
    },
    {
        "formula": "Li6PS5Cl", "common_name": "argyrodite", "structure_type": "argyrodite", "spacegroup": "F-43m",
        "blurb": "Halide-substituted argyrodite: the most widely studied sulfide electrolyte today.",
        "properties": [
            ("ionic_conductivity", 2e-3, "measured", RT, True, "cold-pressed pellet"),
            ("activation_energy", 0.3, "measured", "", True, None),
        ],
        "used_in": [("solid electrolyte", "curated", True)],
    },
    {
        "formula": "Li3PS4", "common_name": "β-LPS", "structure_type": "thiophosphate", "spacegroup": "Pnma",
        "blurb": "Nanoporous β-Li3PS4, a classic sulfide baseline.",
        "properties": [
            ("ionic_conductivity", 1.6e-4, "measured", RT, True, None),
        ],
        "used_in": [("solid electrolyte", "curated", True)],
    },
    {
        "formula": "Li3YCl6", "common_name": "LYC", "structure_type": "halide", "spacegroup": "P-3m1",
        "blurb": "Chloride electrolyte with good oxidation stability for high-voltage cathodes.",
        "properties": [
            ("ionic_conductivity", 5e-4, "measured", RT, True, None),
        ],
        "used_in": [("solid electrolyte", "curated", True)],
    },
    {
        "formula": "Li3InCl6", "common_name": "LIC", "structure_type": "halide", "spacegroup": "C2/m",
        "blurb": "Water-processable chloride electrolyte; indium is a scarce element.",
        "properties": [
            ("ionic_conductivity", 1.5e-3, "measured", RT, True, None),
        ],
        "used_in": [("solid electrolyte", "curated", True)],
    },
    {
        "formula": "Li1.3Al0.3Ti1.7(PO4)3", "common_name": "LATP", "structure_type": "NASICON", "spacegroup": "R-3c",
        "blurb": "Air-stable NASICON oxide; Ti4+ is reduced by lithium metal.",
        "properties": [
            ("ionic_conductivity", 7e-4, "measured", RT, True, "total (bulk + grain boundary)"),
        ],
        "used_in": [("solid electrolyte", "curated", True)],
    },
    {
        "formula": "Li2.9PO3.3N0.46", "common_name": "LiPON", "structure_type": "amorphous thin film", "spacegroup": None,
        "blurb": "Amorphous thin-film electrolyte behind commercial micro-batteries.",
        "properties": [
            ("ionic_conductivity", 2.3e-6, "measured", RT, True, None),
            ("electrochemical_window", 5.5, "measured", "", True, None),
        ],
        "used_in": [("solid electrolyte", "curated", True)],
    },
    {
        "formula": "Na3Zr2Si2PO12", "common_name": "NZSP", "structure_type": "NASICON", "spacegroup": "C2/c",
        "blurb": "The original NASICON sodium superionic conductor.",
        "properties": [
            ("ionic_conductivity", 6.7e-4, "measured", RT, True, None),
        ],
        "used_in": [("solid electrolyte", "curated", True)],
    },
]

# Molecules reuse identifiers from harvest/aliases.MOLECULE_ALIASES (alias key in "alias").
MOLECULES: list[dict] = [
    {"alias": "ec", "name": "ec", "blurb": "High-permittivity cyclic carbonate; forms the graphite SEI. Solid at room temperature.",
     "properties": [("dielectric_constant", 89.8, "measured", '{"temperature_K": 313}', True, None),
                    ("melting_point", 309.5, "measured", "", True, None),
                    ("molecular_weight", 88.06, "measured", "", True, None)],
     "used_in": [("liquid electrolyte solvent", "curated", True)]},
    {"alias": "pc", "name": "pc", "blurb": "Liquid cyclic carbonate; exfoliates graphite without additives.",
     "properties": [("dielectric_constant", 64.9, "measured", RT, True, None),
                    ("melting_point", 224.0, "measured", "", True, None),
                    ("boiling_point", 515.0, "measured", "", True, None),
                    ("molecular_weight", 102.09, "measured", "", True, None)],
     "used_in": [("liquid electrolyte solvent", "curated", True)]},
    {"alias": "dmc", "name": "dmc", "blurb": "Low-viscosity linear carbonate co-solvent.",
     "properties": [("dielectric_constant", 3.1, "measured", RT, True, None),
                    ("viscosity", 0.59, "measured", RT, True, None),
                    ("boiling_point", 363.0, "measured", "", True, None),
                    ("molecular_weight", 90.08, "measured", "", True, None)],
     "used_in": [("liquid electrolyte solvent", "curated", True)]},
    {"alias": "emc", "name": "emc", "blurb": "Asymmetric linear carbonate, wider liquid range than DMC.",
     "properties": [("dielectric_constant", 3.0, "measured", RT, True, None),
                    ("viscosity", 0.65, "measured", RT, True, None),
                    ("molecular_weight", 104.10, "measured", "", True, None)],
     "used_in": [("liquid electrolyte solvent", "curated", True)]},
    {"alias": "dme", "name": "dme", "blurb": "Ether solvent favoured for lithium-metal and Li-S cells.",
     "properties": [("dielectric_constant", 7.2, "measured", RT, True, None),
                    ("viscosity", 0.46, "measured", RT, True, None),
                    ("molecular_weight", 90.12, "measured", "", True, None)],
     "used_in": [("liquid electrolyte solvent", "curated", True)]},
    {"alias": "fec", "name": "fec", "blurb": "Fluorinated additive that builds a LiF-rich SEI, key for silicon anodes.",
     "properties": [("molecular_weight", 106.05, "measured", "", True, None)],
     "used_in": [("electrolyte additive", "curated", True)]},
    {"alias": "vc", "name": "vc", "blurb": "Classic SEI-forming additive that polymerises on graphite.",
     "properties": [("molecular_weight", 86.05, "measured", "", True, None)],
     "used_in": [("electrolyte additive", "curated", True)]},
    {"alias": "lipf6", "name": "lipf6", "blurb": "The standard Li-ion salt: balanced properties, hydrolyses to HF.",
     "properties": [("molecular_weight", 151.91, "measured", "", True, None)],
     "used_in": [("electrolyte salt", "curated", True)]},
    {"alias": "litfsi", "name": "litfsi", "blurb": "Thermally stable imide salt; corrodes aluminium above ~3.8 V.",
     "properties": [("molecular_weight", 287.09, "measured", "", True, None)],
     "used_in": [("electrolyte salt", "curated", True)]},
    {"alias": "lifsi", "name": "lifsi", "blurb": "Imide salt with high conductivity, popular in high-concentration electrolytes.",
     "properties": [("molecular_weight", 187.07, "measured", "", True, None)],
     "used_in": [("electrolyte salt", "curated", True)]},
    {"alias": "peo", "name": "peo", "blurb": "Polymer host for solid polymer electrolytes; conducts well only above its melting point.",
     "properties": [("ionic_conductivity", 1e-4, "measured", '{"temperature_K": 333, "salt": "LiTFSI"}', True, "with LiTFSI at 60 °C"),
                    ("ionic_conductivity", 1e-6, "measured", '{"temperature_K": 298, "salt": "LiTFSI"}', True, "with LiTFSI at room temperature")],
     "used_in": [("polymer electrolyte host", "curated", True)]},
]
