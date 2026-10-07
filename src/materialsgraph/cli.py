"""`mg` -- single entrypoint for every stage of the pipeline.

    mg schema apply|reset|backfill
    mg ingest mp [--ions Li,Na] | optimade [--provider oqmd] | liverpool [--csv path] | molecules [--offline]
    mg load [--mp] [--optimade oqmd] [--liverpool] [--molecules]
    mg harvest discover|fulltext|extract|validate|review|commit|stats|run
    mg embed [--chunks]
    mg similar
    mg ask "question" [--use-case ...] [--show-cypher]
    mg summary
    mg site build-sample | purge-sample --yes | json-schema
    mg export site [--out web/public/data/snapshot.json]
    mg import snapshot PATH [--force]
"""

from __future__ import annotations

import argparse
import json
import sys


def _session():
    from materialsgraph.graph.connection import session

    return session()


# ---------------------------------------------------------------------------
def cmd_schema(args) -> None:
    from materialsgraph.graph import writers
    from materialsgraph.ingestion import schema_loader

    with _session() as s:
        if args.action == "reset":
            if not args.yes:
                sys.exit("refusing to wipe the graph without --yes")
            writers.reset_graph(s, confirm=True)
            print("graph wiped")
        if args.action in ("apply", "reset"):
            schema_loader.apply_schema(s)
            schema_loader.seed_reference_data(s, with_elements=not args.no_elements)
        if args.action == "backfill":
            schema_loader.backfill_v2(s)


def cmd_ingest(args) -> None:
    if args.source == "mp":
        from materialsgraph.ingestion import mp_client

        mp_client.main(["--ions", args.ions, "--max-records", str(args.max_records)])
    elif args.source == "optimade":
        from materialsgraph.ingestion import optimade_client

        argv = ["--provider", args.provider, "--max-pages", str(args.max_pages)]
        if args.filter:
            argv += ["--filter", args.filter]
        optimade_client.main(argv)
    elif args.source == "liverpool":
        from materialsgraph.ingestion import liverpool_ionics

        liverpool_ionics.main(["--csv", args.csv] if args.csv else [])
    elif args.source == "molecules":
        from materialsgraph.ingestion import pubchem_client

        pubchem_client.main(["--offline"] if args.offline else [])


def cmd_load(args) -> None:
    from materialsgraph.graph.reference import PUBCHEM_SOURCE_ID
    from materialsgraph.ingestion import schema_loader

    everything = not (args.mp or args.optimade or args.liverpool or args.molecules)
    with _session() as s:
        schema_loader.apply_schema(s)
        schema_loader.seed_reference_data(s)
        if args.mp or everything:
            schema_loader.load_all_raw(s)
        if args.optimade:
            from materialsgraph.ingestion.optimade_client import load_saved

            schema_loader.load_external_records(s, load_saved(args.optimade))
        if args.liverpool:
            from materialsgraph.ingestion.liverpool_ionics import load_saved as load_liv

            records, license_excerpt = load_liv()
            if license_excerpt:
                from materialsgraph.graph.reference import LIVERPOOL_SOURCE_ID

                s.run("MATCH (src:Source {source_id: $id}) SET src.license = $lic", id=LIVERPOOL_SOURCE_ID, lic=license_excerpt[:200])
            schema_loader.load_measured_records(s, records)
        if args.molecules:
            from materialsgraph.ingestion.pubchem_client import load_saved as load_mol

            schema_loader.load_molecules(s, load_mol(), PUBCHEM_SOURCE_ID)
        schema_loader.print_summary(s)


def cmd_harvest(args) -> None:
    from materialsgraph.enrichment import literature_agent as la
    from materialsgraph.harvest import stage

    if args.action == "discover":
        from materialsgraph.harvest.discover import discover, make_connectors

        kws = [k.strip() for k in args.keywords.split(",")] if args.keywords else None
        discover(kws, connectors=make_connectors(args.connectors.split(",")), since_year=args.since, limit_per_query=args.limit, batch_id=args.batch, complete_with_crossref=args.crossref, unpaywall=args.unpaywall)
    elif args.action == "fulltext":
        la.fetch_fulltext(args.batch, max_docs=args.max)
    elif args.action == "extract":
        from materialsgraph.llm.local_client import StructuredLLM

        la.extract_batch(args.batch, StructuredLLM(args.model), max_sources=args.max, use_chunks=not args.no_chunks)
    elif args.action == "validate":
        if args.no_graph:
            la.validate_batch(args.batch, None, cloud=args.cloud)
        else:
            with _session() as s:
                la.validate_batch(args.batch, s, cloud=args.cloud)
    elif args.action == "review":
        from materialsgraph.harvest.review_cli import review_batch

        review_batch(args.batch, only_kind=args.kind, only_status=args.status)
    elif args.action == "commit":
        from materialsgraph.harvest.commit import commit_batch

        with _session() as s:
            print(json.dumps(commit_batch(s, args.batch, include_pending=args.include_pending), indent=2))
    elif args.action == "stats":
        batches = [args.batch] if args.batch else stage.list_batches()
        for b in batches:
            print(b, json.dumps(stage.queue_stats(stage.read_queue(b)), indent=2))
    elif args.action == "run":
        kws = [k.strip() for k in args.keywords.split(",")] if args.keywords else None
        if args.no_graph:
            la.run_harvest(kws, connectors=args.connectors.split(","), since_year=args.since, limit=args.limit, fulltext=args.fulltext, max_sources=args.max, cloud_validate=args.cloud)
        else:
            with _session() as s:
                la.run_harvest(kws, connectors=args.connectors.split(","), since_year=args.since, limit=args.limit, fulltext=args.fulltext, max_sources=args.max, session=s, cloud_validate=args.cloud)


def cmd_embed(args) -> None:
    from materialsgraph.enrichment.embeddings import Embedder, embed_chunks, embed_sources

    emb = Embedder()
    with _session() as s:
        print(f"embedded {embed_sources(s, emb, limit=args.limit)} sources")
        if args.chunks:
            print(f"embedded {embed_chunks(s, emb, limit=args.limit)} chunks")


def cmd_similar(args) -> None:
    from materialsgraph.enrichment.similarity import write_similar_to

    with _session() as s:
        print(f"wrote {write_similar_to(s, top_k=args.top_k, min_score=args.min_score)} SIMILAR_TO edges (confirmed=false)")


def cmd_ask(args) -> None:
    from materialsgraph.query.nl_to_cypher import main as ask_main

    argv = [args.question]
    if args.use_case:
        argv += ["--use-case", args.use_case]
    if args.show_cypher:
        argv.append("--show-cypher")
    if args.no_embeddings:
        argv.append("--no-embeddings")
    if args.json:
        argv.append("--json")
    ask_main(argv)


def cmd_summary(args) -> None:
    from materialsgraph.ingestion.schema_loader import print_summary

    with _session() as s:
        print_summary(s)


def cmd_query(args) -> None:
    from materialsgraph.graph import queries

    with _session() as s:
        if args.what == "coverage":
            out = queries.get_property_coverage(s) if not args.application else queries.get_application_coverage(s, args.application)
        elif args.what == "missing":
            out = queries.get_missing_property(s, args.property or "ionic_conductivity", args.application or queries.APPLICATION_NAME)
        elif args.what == "top":
            out = queries.get_top_candidates(s)
        else:
            out = queries.get_electrode_summary(s)
    print(json.dumps(out, indent=2, default=str))


DEFAULT_SNAPSHOT = "web/public/data/snapshot.json"
DEFAULT_SCHEMA = "web/src/data/snapshot.schema.json"


def cmd_site(args) -> None:
    if args.action == "build-sample":
        from materialsgraph.site.build import build_sample_snapshot

        snap = build_sample_snapshot()
        path = snap.write(args.out)
        print(f"sample snapshot -> {path} {snap.meta.counts}")
    elif args.action == "json-schema":
        from materialsgraph.site.snapshot_models import main as schema_main

        schema_main(["--json-schema", args.out if args.out != DEFAULT_SNAPSHOT else DEFAULT_SCHEMA])
    elif args.action == "purge-sample":
        if not args.yes:
            sys.exit("refusing to purge without --yes")
        from materialsgraph.graph import writers

        with _session() as s:
            print(writers.purge_sample(s, confirm=True))


def cmd_export(args) -> None:
    from materialsgraph.site.export import export_snapshot

    with _session() as s:
        snap = export_snapshot(s, include_quotes=args.include_quotes, max_materials=args.max_materials, recompute_similar=args.recompute_similar)
    path = snap.write(args.out)
    print(f"snapshot -> {path} {snap.meta.counts} (sample={snap.meta.sample})")


def cmd_import(args) -> None:
    from materialsgraph.site.import_snapshot import ImportRefused, import_snapshot
    from materialsgraph.site.snapshot_models import Snapshot

    snap = Snapshot.read(args.path)
    with _session() as s:
        try:
            print(import_snapshot(s, snap, force=args.force))
        except ImportRefused as exc:
            sys.exit(str(exc))


# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="mg", description="MaterialsGraph pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("schema", help="apply/reset schema and seed reference data")
    s.add_argument("action", choices=["apply", "reset", "backfill"])
    s.add_argument("--yes", action="store_true", help="confirm destructive reset")
    s.add_argument("--no-elements", action="store_true")
    s.set_defaults(func=cmd_schema)

    i = sub.add_parser("ingest", help="pull structured data to data/raw/")
    isub = i.add_subparsers(dest="source", required=True)
    mp = isub.add_parser("mp"); mp.add_argument("--ions", default="Li"); mp.add_argument("--max-records", type=int, default=150)
    op = isub.add_parser("optimade"); op.add_argument("--provider", default="oqmd"); op.add_argument("--filter"); op.add_argument("--max-pages", type=int, default=5)
    lv = isub.add_parser("liverpool"); lv.add_argument("--csv")
    mo = isub.add_parser("molecules"); mo.add_argument("--offline", action="store_true")
    i.set_defaults(func=cmd_ingest)

    ld = sub.add_parser("load", help="load data/raw/ into Neo4j")
    ld.add_argument("--mp", action="store_true"); ld.add_argument("--optimade", metavar="PROVIDER"); ld.add_argument("--liverpool", action="store_true"); ld.add_argument("--molecules", action="store_true")
    ld.set_defaults(func=cmd_load)

    h = sub.add_parser("harvest", help="literature harvester")
    h.add_argument("action", choices=["discover", "fulltext", "extract", "validate", "review", "commit", "stats", "run"])
    h.add_argument("--batch"); h.add_argument("--keywords"); h.add_argument("--connectors", default="openalex"); h.add_argument("--since", type=int)
    h.add_argument("--limit", type=int, default=50); h.add_argument("--max", type=int); h.add_argument("--model"); h.add_argument("--cloud", action="store_true")
    h.add_argument("--crossref", action="store_true"); h.add_argument("--unpaywall", action="store_true"); h.add_argument("--fulltext", action="store_true")
    h.add_argument("--no-chunks", action="store_true"); h.add_argument("--no-graph", action="store_true", help="validate without a Neo4j connection (resolution limited)")
    h.add_argument("--kind", choices=["material", "property_value", "used_in", "gap"]); h.add_argument("--status", default="pending")
    h.add_argument("--include-pending", action="store_true", help="also write validated pending candidates as confirmed=false")
    h.set_defaults(func=cmd_harvest)

    e = sub.add_parser("embed", help="embed Source abstracts (and Chunks)")
    e.add_argument("--chunks", action="store_true"); e.add_argument("--limit", type=int)
    e.set_defaults(func=cmd_embed)

    sm = sub.add_parser("similar", help="write composition-based SIMILAR_TO edges (confirmed=false)")
    sm.add_argument("--top-k", type=int, default=5); sm.add_argument("--min-score", type=float, default=0.85)
    sm.set_defaults(func=cmd_similar)

    a = sub.add_parser("ask", help="GraphRAG question answering")
    a.add_argument("question"); a.add_argument("--use-case", choices=["screening", "feasibility", "composition", "literature", "gaps", "freeform"])
    a.add_argument("--show-cypher", action="store_true"); a.add_argument("--no-embeddings", action="store_true"); a.add_argument("--json", action="store_true")
    a.set_defaults(func=cmd_ask)

    q = sub.add_parser("query", help="canned read queries")
    q.add_argument("what", choices=["coverage", "missing", "top", "electrodes"]); q.add_argument("--application"); q.add_argument("--property")
    q.set_defaults(func=cmd_query)

    sub.add_parser("summary", help="node/edge counts").set_defaults(func=cmd_summary)

    st = sub.add_parser("site", help="showcase website data")
    st.add_argument("action", choices=["build-sample", "purge-sample", "json-schema"])
    st.add_argument("--out", default=DEFAULT_SNAPSHOT); st.add_argument("--yes", action="store_true")
    st.set_defaults(func=cmd_site)

    ex = sub.add_parser("export", help="export the graph for the website")
    ex.add_argument("what", choices=["site"]); ex.add_argument("--out", default=DEFAULT_SNAPSHOT)
    ex.add_argument("--include-quotes", action="store_true", help="include short supporting quotes (never abstracts or chunks)")
    ex.add_argument("--max-materials", type=int); ex.add_argument("--recompute-similar", action="store_true")
    ex.set_defaults(func=cmd_export)

    im = sub.add_parser("import", help="load a snapshot into Neo4j (e.g. seed AuraDB Free)")
    im.add_argument("what", choices=["snapshot"]); im.add_argument("path"); im.add_argument("--force", action="store_true")
    im.set_defaults(func=cmd_import)
    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
