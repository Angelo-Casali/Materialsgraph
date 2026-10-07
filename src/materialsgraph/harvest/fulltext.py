"""Open-access full text: fetch (license-gated), extract with pypdf, chunk.

Only sources whose license is open (connectors/base.OPEN_LICENSES) are
downloaded and chunked; everything else stays abstract-only. PDFs are cached
under data/fulltext/ (gitignored). Chunk text is stored in the graph as Chunk
nodes -- never redistributed with the code, same boundary as strategy.md's
personal-library rule.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import requests

from materialsgraph.harvest.connectors.base import is_open_license, polite_headers
from materialsgraph.harvest.models import SourceRecord, TextChunk

CACHE_DIR = Path("data/fulltext")
CHUNK_WORDS = 350  # ~ 450-500 tokens
OVERLAP_WORDS = 60
SECTION_RE = re.compile(r"^\s*(abstract|introduction|results?( and discussion)?|discussion|experimental|methods?|conclusions?|references?|acknowledg\w+)\b", re.IGNORECASE)


def chunk_id_for(source_id: str, ordinal: int) -> str:
    return hashlib.sha1(f"{source_id}|{ordinal}".encode()).hexdigest()[:16]


def pdf_path(source_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", source_id)
    return CACHE_DIR / f"{safe}.pdf"


def fetch_pdf(record: SourceRecord, http: requests.Session | None = None, *, force: bool = False) -> Path | None:
    """Download the OA PDF when the license allows storing its text. Returns the cached path or None."""
    if not record.oa_pdf_url:
        return None
    if not is_open_license(record.license):
        return None
    path = pdf_path(record.source_id)
    if path.exists() and not force:
        return path
    http = http or requests.Session()
    try:
        resp = http.get(record.oa_pdf_url, headers={**polite_headers(), "Accept": "application/pdf,*/*"}, timeout=60)
        if not resp.ok or "pdf" not in (resp.headers.get("Content-Type", "").lower() + record.oa_pdf_url.lower()):
            return None
    except requests.RequestException as exc:
        print(f"PDF download failed for {record.source_id}: {exc}")
        return None
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(resp.content)
    return path


def extract_pages(path: Path) -> list[str]:
    try:
        from pypdf import PdfReader  # optional dependency: pip install materialsgraph[fulltext]
    except ImportError as exc:
        raise RuntimeError("pypdf is required for full-text extraction: pip install pypdf") from exc
    reader = PdfReader(str(path))
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            pages.append("")
    return pages


def _clean(text: str) -> str:
    text = text.replace("-\n", "")  # de-hyphenate line breaks
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n\n", text)
    return text.strip()


def chunk_pages(source_id: str, pages: list[str], *, chunk_words: int = CHUNK_WORDS, overlap: int = OVERLAP_WORDS) -> list[TextChunk]:
    """Sliding-window word chunks that remember page and (roughly) section; stops at the references section."""
    chunks: list[TextChunk] = []
    section = "body"
    ordinal = 0
    buffer: list[tuple[str, int]] = []  # (word, page)

    def flush(final: bool = False) -> None:
        nonlocal buffer, ordinal
        while len(buffer) >= chunk_words or (final and buffer):
            window = buffer[:chunk_words]
            text = " ".join(w for w, _ in window)
            chunks.append(TextChunk(chunk_id=chunk_id_for(source_id, ordinal), source_id=source_id, text=text, ordinal=ordinal, section=section, page=window[0][1]))
            ordinal += 1
            if final and len(buffer) <= chunk_words:
                buffer = []
                break
            buffer = buffer[chunk_words - overlap :]

    for page_no, raw in enumerate(pages, start=1):
        for line in _clean(raw).split("\n"):
            m = SECTION_RE.match(line)
            if m:
                head = m.group(1).lower()
                if head.startswith("reference") or head.startswith("acknowledg"):
                    flush(final=True)
                    return chunks
                section = head
            buffer.extend((w, page_no) for w in line.split())
        flush()
    flush(final=True)
    return chunks


def chunks_from_sections(source_id: str, sections: list[tuple[str, str]], *, chunk_words: int = CHUNK_WORDS, overlap: int = OVERLAP_WORDS) -> list[TextChunk]:
    """For connectors that already give sectioned text (Europe PMC JATS)."""
    chunks: list[TextChunk] = []
    ordinal = 0
    for title, text in sections:
        if title.lower().startswith("reference"):
            continue
        words = text.split()
        start = 0
        while start < len(words):
            window = words[start : start + chunk_words]
            chunks.append(TextChunk(chunk_id=chunk_id_for(source_id, ordinal), source_id=source_id, text=" ".join(window), ordinal=ordinal, section=title))
            ordinal += 1
            if start + chunk_words >= len(words):
                break
            start += chunk_words - overlap
    return chunks


def fulltext_chunks(record: SourceRecord, http: requests.Session | None = None) -> list[TextChunk]:
    path = fetch_pdf(record, http)
    if path is None:
        return []
    return chunk_pages(record.source_id, extract_pages(path))
