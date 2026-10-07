import pytest

from materialsgraph.query.cypher_safety import UnsafeCypherError, validate_read_only


@pytest.mark.parametrize(
    "cypher",
    [
        "MATCH (m:Material) RETURN m.formula LIMIT 10",
        "MATCH (m:Material)-[:HAS_PROPERTY]->(pv) WHERE pv.value > 3 RETURN m.material_key, pv.value",
        "OPTIONAL MATCH (m:Material) RETURN count(m)",
        "WITH 1 AS x RETURN x",
        "UNWIND [1,2] AS x RETURN x",
        "CALL db.index.fulltext.queryNodes('source_text', 'argyrodite') YIELD node RETURN node.title",
        "CALL db.index.vector.queryNodes('source_abstract_embedding', 5, $vec) YIELD node, score RETURN node.source_id, score",
        "MATCH (m:Material {formula: 'CREATE'}) RETURN m // SET in a comment is fine",
        "MATCH (m:Material) WHERE m.formula = \"MERGE (x)\" RETURN m",
        "MATCH (m:Material) RETURN m.formula LIMIT $max_limit",
    ],
)
def test_allows_read_only(cypher):
    out = validate_read_only(cypher)
    assert "LIMIT" in out.upper()


@pytest.mark.parametrize(
    "cypher",
    [
        "CREATE (m:Material {formula: 'X'}) RETURN m",
        "MATCH (m:Material) SET m.formula = 'x' RETURN m",
        "MATCH (m:Material) DELETE m",
        "MATCH (m) DETACH DELETE m",
        "MERGE (m:Material {material_key: 'k'}) RETURN m",
        "MATCH (m:Material) REMOVE m.formula RETURN m",
        "DROP CONSTRAINT material_key",
        "MATCH (m) RETURN m; MATCH (n) DELETE n",
        "CALL apoc.load.json('http://x') YIELD value RETURN value",
        "CALL dbms.components() YIELD name RETURN name",
        "CALL db.labels() YIELD label RETURN label",
        "MATCH (m) CALL { WITH m CREATE (n) } RETURN m",
        "LOAD CSV FROM 'file:///x.csv' AS row RETURN row",
        "RETURN 1 FOREACH (x IN [1] | CREATE (:N))",
        "SHOW DATABASES",
        "",
        "MATCH (m:Material) WITH m LIMIT 5",  # no RETURN and no LIMIT at end -> unsafe/unbounded
    ],
)
def test_rejects_writes_and_admin(cypher):
    with pytest.raises(UnsafeCypherError):
        validate_read_only(cypher)


def test_limit_is_bounded_and_appended():
    assert validate_read_only("MATCH (m) RETURN m LIMIT 99999", max_limit=200).endswith("LIMIT 200")
    assert validate_read_only("MATCH (m) RETURN m", max_limit=50).endswith("LIMIT 50")
    assert validate_read_only("MATCH (m) RETURN m LIMIT 7;").endswith("LIMIT 7")
