"""Hand-entered alias tables for the resolver.

FORMULA_ALIASES: battery acronyms -> a concrete representative formula.
MOLECULE_ALIASES: electrolyte species -> identifiers. InChIKeys/SMILES here are
the standard PubChem values; ingestion/pubchem_client.py can refresh them.
"""

from __future__ import annotations

FORMULA_ALIASES: dict[str, str] = {
    # solid electrolytes
    "llzo": "Li7La3Zr2O12",
    "llzto": "Li6.4La3Zr1.4Ta0.6O12",
    "lgps": "Li10GeP2S12",
    "lsps": "Li10SnP2S12",
    "latp": "Li1.3Al0.3Ti1.7(PO4)3",
    "lagp": "Li1.5Al0.5Ge1.5(PO4)3",
    "llto": "Li0.33La0.56TiO3",
    "lipon": "Li2.9PO3.3N0.46",
    "lps": "Li3PS4",
    "li3ps4": "Li3PS4",
    "li6ps5cl": "Li6PS5Cl",
    "li6ps5br": "Li6PS5Br",
    "argyrodite": "Li6PS5Cl",
    "li3ycl6": "Li3YCl6",
    "li3incl6": "Li3InCl6",
    "lic": "Li3InCl6",
    "lyc": "Li3YCl6",
    "lyb": "Li3YBr6",
    "nasicon": "Na3Zr2Si2PO12",
    "nzsp": "Na3Zr2Si2PO12",
    "na-beta-alumina": "NaAl11O17",
    "lisicon": "Li14Zn(GeO4)4",
    # cathodes
    "nmc": "LiNi0.33Mn0.33Co0.33O2",
    "nmc111": "LiNi0.33Mn0.33Co0.33O2",
    "nmc333": "LiNi0.33Mn0.33Co0.33O2",
    "nmc532": "LiNi0.5Mn0.3Co0.2O2",
    "nmc622": "LiNi0.6Mn0.2Co0.2O2",
    "nmc811": "LiNi0.8Mn0.1Co0.1O2",
    "ncm811": "LiNi0.8Mn0.1Co0.1O2",
    "nca": "LiNi0.8Co0.15Al0.05O2",
    "lco": "LiCoO2",
    "lfp": "LiFePO4",
    "lmp": "LiMnPO4",
    "lmfp": "LiMn0.6Fe0.4PO4",
    "lmo": "LiMn2O4",
    "lnmo": "LiNi0.5Mn1.5O4",
    "lnmo spinel": "LiNi0.5Mn1.5O4",
    "lrnmc": "Li1.2Ni0.13Mn0.54Co0.13O2",
    "nfpp": "Na4Fe3(PO4)2P2O7",
    "nvp": "Na3V2(PO4)3",
    "nvpf": "Na3V2(PO4)2F3",
    "prussian white": "Na2Fe[Fe(CN)6]",
    # anodes
    "lto": "Li4Ti5O12",
    "graphite": "C",
    "hard carbon": "C",
    "silicon": "Si",
    "lithium metal": "Li",
}

MOLECULE_ALIASES: dict[str, dict] = {
    "lipf6": {"common_name": "LiPF6", "formula": "LiPF6", "inchikey": "AXPLOJNSKRXQPA-UHFFFAOYSA-N", "smiles": "[Li+].F[P-](F)(F)(F)(F)F", "roles": ["electrolyte salt"], "aliases": ["lithium hexafluorophosphate"]},
    "litfsi": {"common_name": "LiTFSI", "formula": "LiC2F6NO4S2", "inchikey": "QSZMZKBZAYQGRS-UHFFFAOYSA-N", "smiles": "[Li+].C(F)(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", "roles": ["electrolyte salt"], "aliases": ["lithium bis(trifluoromethanesulfonyl)imide", "lithium bistriflimide"]},
    "lifsi": {"common_name": "LiFSI", "formula": "LiF2NO4S2", "inchikey": "VDVLPSWVDYJFRW-UHFFFAOYSA-N", "smiles": "[Li+].FS(=O)(=O)[N-]S(=O)(=O)F", "roles": ["electrolyte salt"], "aliases": ["lithium bis(fluorosulfonyl)imide"]},
    "libf4": {"common_name": "LiBF4", "formula": "LiBF4", "inchikey": "UVPEEUXLCBAJMB-UHFFFAOYSA-N", "smiles": "[Li+].F[B-](F)(F)F", "roles": ["electrolyte salt"], "aliases": ["lithium tetrafluoroborate"]},
    "libob": {"common_name": "LiBOB", "formula": "LiC4BO8", "inchikey": "UIWJWGXOJTXDQJ-UHFFFAOYSA-N", "smiles": None, "roles": ["electrolyte salt", "electrolyte additive"], "aliases": ["lithium bis(oxalato)borate"]},
    "lidfob": {"common_name": "LiDFOB", "formula": "LiC2BF2O4", "inchikey": None, "smiles": None, "roles": ["electrolyte additive", "electrolyte salt"], "aliases": ["lithium difluoro(oxalato)borate"]},
    "liclo4": {"common_name": "LiClO4", "formula": "LiClO4", "inchikey": "MHCFAGZWMAWTNR-UHFFFAOYSA-M", "smiles": "[Li+].[O-]Cl(=O)(=O)=O", "roles": ["electrolyte salt"], "aliases": ["lithium perchlorate"]},
    "napf6": {"common_name": "NaPF6", "formula": "NaPF6", "inchikey": "PWFSQIVIRHJCCO-UHFFFAOYSA-N", "smiles": "[Na+].F[P-](F)(F)(F)(F)F", "roles": ["electrolyte salt"], "aliases": ["sodium hexafluorophosphate"]},
    "ec": {"common_name": "EC", "formula": "C3H4O3", "inchikey": "KMTRUDSVKNLOMY-UHFFFAOYSA-N", "smiles": "C1COC(=O)O1", "roles": ["liquid electrolyte solvent"], "aliases": ["ethylene carbonate"]},
    "pc": {"common_name": "PC", "formula": "C4H6O3", "inchikey": "RUOJZAUFBMNUDX-UHFFFAOYSA-N", "smiles": "CC1COC(=O)O1", "roles": ["liquid electrolyte solvent"], "aliases": ["propylene carbonate"]},
    "dmc": {"common_name": "DMC", "formula": "C3H6O3", "inchikey": "IEJIGPNLZYLLBP-UHFFFAOYSA-N", "smiles": "COC(=O)OC", "roles": ["liquid electrolyte solvent"], "aliases": ["dimethyl carbonate"]},
    "dec": {"common_name": "DEC", "formula": "C5H10O3", "inchikey": "OIFBSDVPJOWBCH-UHFFFAOYSA-N", "smiles": "CCOC(=O)OCC", "roles": ["liquid electrolyte solvent"], "aliases": ["diethyl carbonate"]},
    "emc": {"common_name": "EMC", "formula": "C4H8O3", "inchikey": "JBTWLSYIZRCDFO-UHFFFAOYSA-N", "smiles": "CCOC(=O)OC", "roles": ["liquid electrolyte solvent"], "aliases": ["ethyl methyl carbonate"]},
    "fec": {"common_name": "FEC", "formula": "C3H3FO3", "inchikey": "SBLRHMKNNHXPHG-UHFFFAOYSA-N", "smiles": "C1C(OC(=O)O1)F", "roles": ["electrolyte additive", "liquid electrolyte solvent"], "aliases": ["fluoroethylene carbonate"]},
    "vc": {"common_name": "VC", "formula": "C3H2O3", "inchikey": "VAYTZRYEBVHVLE-UHFFFAOYSA-N", "smiles": "C1=COC(=O)O1", "roles": ["electrolyte additive"], "aliases": ["vinylene carbonate"]},
    "dme": {"common_name": "DME", "formula": "C4H10O2", "inchikey": "XTHFKEDIFFGKHM-UHFFFAOYSA-N", "smiles": "COCCOC", "roles": ["liquid electrolyte solvent"], "aliases": ["1,2-dimethoxyethane", "dimethoxyethane", "glyme"]},
    "dol": {"common_name": "DOL", "formula": "C3H6O2", "inchikey": "WNXJIVFYUVYPPR-UHFFFAOYSA-N", "smiles": "C1COCO1", "roles": ["liquid electrolyte solvent"], "aliases": ["1,3-dioxolane", "dioxolane"]},
    "ttе": {"common_name": "TTE", "formula": "C4H3F7O", "inchikey": None, "smiles": None, "roles": ["liquid electrolyte solvent"], "aliases": ["1,1,2,2-tetrafluoroethyl 2,2,3,3-tetrafluoropropyl ether"]},
    "peo": {"common_name": "PEO", "formula": "C2H4O", "inchikey": None, "smiles": "C(CO)O", "roles": ["polymer electrolyte host"], "aliases": ["poly(ethylene oxide)", "polyethylene oxide"]},
    "pvdf": {"common_name": "PVDF", "formula": "C2H2F2", "inchikey": None, "smiles": None, "roles": ["polymer electrolyte host"], "aliases": ["polyvinylidene fluoride", "poly(vinylidene fluoride)"]},
    "pan": {"common_name": "PAN", "formula": "C3H3N", "inchikey": None, "smiles": None, "roles": ["polymer electrolyte host"], "aliases": ["polyacrylonitrile"]},
    "succinonitrile": {"common_name": "SN", "formula": "C4H4N2", "inchikey": "IAHFWCOBPZCAEA-UHFFFAOYSA-N", "smiles": "C(CC#N)C#N", "roles": ["electrolyte additive"], "aliases": ["sn", "butanedinitrile"]},
}


def _molecule_index() -> dict[str, str]:
    index: dict[str, str] = {}
    for key, spec in MOLECULE_ALIASES.items():
        index[key.lower()] = key
        index[spec["common_name"].lower()] = key
        index[spec["formula"].lower()] = key
        for alias in spec.get("aliases", []):
            index[alias.lower()] = key
    return index


_MOLECULE_INDEX = _molecule_index()


def lookup_formula_alias(raw: str) -> str | None:
    return FORMULA_ALIASES.get(raw.strip().lower().replace("-type", "").replace("_", ""))


def lookup_molecule(raw: str) -> dict | None:
    key = _MOLECULE_INDEX.get(raw.strip().lower())
    return MOLECULE_ALIASES[key] if key else None
