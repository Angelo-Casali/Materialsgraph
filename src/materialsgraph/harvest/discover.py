"""Discovery: keywords x connectors -> de-duplicated SourceRecords -> data/harvest/sources/<batch>.jsonl."""

from __future__ import annotations

from materialsgraph.harvest.models import SourceRecord
from materialsgraph.harvest.normalize import dedupe_sources, recent_first
from materialsgraph.harvest.stage import new_batch_id, write_sources

DEFAULT_KEYWORDS = [
    "solid-state electrolyte ionic conductivity",
    "halide solid electrolyte lithium",
    "sulfide argyrodite electrolyte",
    "garnet LLZO electrolyte",
    "sodium-ion cathode material",
    "lithium-ion cathode high nickel",
    "lithium battery electrolyte additive",
    "battery materials roadmap challenges",
]


def make_connectors(names: list[str]) -> list:
    out = []
    for name in names:
        n = name.strip().lower()
        if n == "openalex":
            from materialsgraph.harvest.connectors.openalex import OpenAlexConnector

            out.append(OpenAlexConnector())
        elif n in ("s2", "semantic_scholar", "semanticscholar"):
            from materialsgraph.harvest.connectors.semantic_scholar import SemanticScholarConnector

            out.append(SemanticScholarConnector())
        elif n == "arxiv":
            from materialsgraph.harvest.connectors.arxiv import ArxivConnector

            out.append(ArxivConnector())
        else:
            raise ValueError(f"unknown connector {name!r} (openalex, s2, arxiv)")
    return out


def discover(
    keywords: list[str] | None,
    *,
    connectors: list | None = None,
    since_year: int | None = None,
    limit_per_query: int = 50,
    batch_id: str | None = None,
    complete_with_crossref: bool = False,
    unpaywall: bool = False,
) -> tuple[str, list[SourceRecord]]:
    keywords = keywords or DEFAULT_KEYWORDS
    connectors = connectors if connectors is not None else make_connectors(["openalex"])
    records: list[SourceRecord] = []
    for kw in keywords:
        for conn in connectors:
            got = conn.search(kw, since_year=since_year, limit=limit_per_query)
            print(f"[{conn.name}] {kw!r}: {len(got)} records")
            records.extend(got)
    records = recent_first(dedupe_sources(records))

    if complete_with_crossref:
        from materialsgraph.harvest.connectors.crossref import CrossRefConnector

        cr = CrossRefConnector()
        records = [cr.fill_missing_metadata(r) if (not r.year or not r.abstract or not r.license) else r for r in records]
    if unpaywall:
        from materialsgraph.harvest.connectors.unpaywall import UnpaywallConnector

        up = UnpaywallConnector()
        records = [up.enrich(r) for r in records]

    with_abstract = sum(1 for r in records if r.abstract)
    oa = sum(1 for r in records if r.oa_pdf_url)
    print(f"{len(records)} unique sources; abstract yield {100.0 * with_abstract / len(records):.0f}%; OA pdf links {oa}" if records else "no sources found")

    batch_id = batch_id or new_batch_id(keywords[0])
    path = write_sources(batch_id, records)
    print(f"batch {batch_id}: sources -> {path}")
    return batch_id, records
