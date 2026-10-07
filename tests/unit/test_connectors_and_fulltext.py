from pathlib import Path

from materialsgraph.harvest.connectors.arxiv import parse_feed
from materialsgraph.harvest.connectors.base import is_open_license
from materialsgraph.harvest.connectors.openalex import reconstruct_abstract, to_source_record
from materialsgraph.harvest.fulltext import chunk_pages, chunks_from_sections

FIXTURES = Path(__file__).parent.parent / "fixtures"


def test_openalex_abstract_reconstruction_and_record(fixture_json):
    work = fixture_json("openalex_work.json")
    assert reconstruct_abstract(work["abstract_inverted_index"]).startswith("Li3YCl6 is a promising solid electrolyte")
    rec = to_source_record(work)
    assert rec.source_id == "doi:10.1000/example.2024.001"
    assert rec.openalex_id == "W4390000001"
    assert rec.year == 2024 and rec.type == "paper"
    assert rec.license == "cc-by" and rec.oa_pdf_url.endswith(".pdf")
    assert rec.authors == ["A. Author", "B. Writer"]
    assert rec.venue == "Journal of Example Science"


def test_arxiv_feed_parsing():
    recs = parse_feed((FIXTURES / "arxiv_feed.xml").read_text())
    assert len(recs) == 1
    r = recs[0]
    assert r.arxiv_id == "2501.01234"
    assert r.source_id == "doi:10.1000/arxiv.example"
    assert r.title == "Argyrodite Li6PS5Cl electrolytes: a review"
    assert r.year == 2025 and r.type == "preprint"
    assert r.oa_pdf_url.endswith("2501.01234v2")


def test_open_license_gate():
    assert is_open_license("cc-by")
    assert is_open_license("CC-BY-NC-ND")
    assert not is_open_license(None)
    assert not is_open_license("publisher-specific-oa")


def test_chunk_pages_windows_and_stops_at_references():
    words = " ".join(f"w{i}" for i in range(900))
    pages = ["Introduction\n" + words, "Results\n" + words, "References\n1. Some ref"]
    chunks = chunk_pages("doi:x", pages, chunk_words=350, overlap=50)
    assert chunks, "no chunks produced"
    assert all(len(c.text.split()) <= 350 for c in chunks)
    assert chunks[0].section == "introduction" and chunks[0].page == 1
    assert all("Some ref" not in c.text for c in chunks)
    ids = [c.chunk_id for c in chunks]
    assert len(ids) == len(set(ids))
    # overlap: last words of chunk 0 appear at start of chunk 1
    assert chunks[0].text.split()[-1] in chunks[1].text.split()[:50]


def test_chunks_from_sections_skips_references():
    sections = [("Introduction", "a " * 100), ("References", "ref " * 10)]
    chunks = chunks_from_sections("doi:y", sections, chunk_words=40, overlap=10)
    assert all(c.section == "Introduction" for c in chunks)
    assert len(chunks) == 3
