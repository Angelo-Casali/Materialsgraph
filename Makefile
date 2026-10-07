.PHONY: install neo4j schema reset ingest load harvest embed test lint

install:
	pip install -e ".[dev,fulltext]"

neo4j:
	docker compose up -d

schema:
	mg schema apply

reset:
	mg schema reset --yes && mg load

ingest:
	mg ingest mp --ions Li,Na

load:
	mg load

harvest:
	mg harvest run --keywords "halide solid electrolyte,argyrodite conductivity" --since 2023 --limit 40

embed:
	mg embed --chunks

test:
	pytest -q

lint:
	ruff check src tests
