#!/usr/bin/env python3
"""Expand-only check for migrations, run before a blue-green release (see README.md in this folder).

While a release runs, the LIVE slot keeps serving on the old code, so a migration that removes or changes something the old code reads
breaks it. This lints the SQL of the migrations a release adds and fails on the patterns that do that. A migration that must do one of
them (a real contract step, done in a later release) can say so with a line `-- bluegreen-ok: <why>` in the file, which is then a
reviewed exception in the diff, not a silent pass.

    python3 migration-lint.py <file.sql> ...      exit 1 when a file has a breaking statement
    python3 migration-lint.py --selftest
"""
import re
import sys

OK_MARKER = re.compile(r"--\s*bluegreen-ok:\s*\S", re.IGNORECASE)

# Each rule is checked against one statement at a time, with comments removed.
RULES = [
    ("drops a column, table, policy, schema or view",
     re.compile(r"\bDROP\s+(COLUMN|TABLE|POLICY|SCHEMA|VIEW|MATERIALIZED\s+VIEW)\b", re.I)),
    ("renames a table, column or constraint",
     re.compile(r"\bRENAME\s+(TO|COLUMN|CONSTRAINT)\b", re.I)),
    ("changes a column's type or makes it NOT NULL",
     re.compile(r"\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b|\bSET\s+NOT\s+NULL\b", re.I)),
    ("changes an enum or a type",
     re.compile(r"\bALTER\s+TYPE\b", re.I)),
    ("empties a table",
     re.compile(r"\bTRUNCATE\b", re.I)),
]
NAMED_DROP = re.compile(r"\bDROP\s+(CONSTRAINT|TRIGGER)\s+(IF\s+EXISTS\s+)?(\w+)", re.I)
NOT_NULL_ADD = re.compile(r"\bADD\s+(COLUMN\s+)?\w+\s[^,]*\bNOT\s+NULL\b", re.I)


def strip_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    return re.sub(r"--[^\n]*", " ", sql)


def added_names(sql: str) -> set:
    """Names that the file creates again (ADD CONSTRAINT x / CREATE TRIGGER x): a drop of one of these is a replace, not a removal."""
    names = set(re.findall(r"\bADD\s+CONSTRAINT\s+(\w+)", sql, re.I))
    names |= set(re.findall(r"\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)", sql, re.I))
    return {n.lower() for n in names}


def findings(sql: str):
    """(rule name, statement) for every breaking statement in one migration file."""
    if OK_MARKER.search(sql):
        return []
    clean = strip_comments(sql)
    replaced = added_names(clean)
    out = []
    for stmt in clean.split(";"):
        stmt = " ".join(stmt.split())
        if not stmt:
            continue
        for name, pat in RULES:
            if pat.search(stmt):
                out.append((name, stmt[:140]))
        for m in NAMED_DROP.finditer(stmt):
            if m.group(3).lower() not in replaced:
                out.append(("drops a constraint or trigger that is not re-added in the same file", stmt[:140]))
        # each ADD COLUMN item is judged on its own: "ADD COLUMN a text, ADD COLUMN b text NOT NULL DEFAULT ''" is fine
        for item in re.split(r",\s*(?=ADD\s)", stmt, flags=re.I):
            # An ADD CONSTRAINT adds no column, and "IS NOT NULL" inside a CHECK expression is a test, not a NOT NULL column: both
            # used to be read as "adds a NOT NULL column" (CHECK (a IS NULL OR b IS NOT NULL) blocked a purely additive migration).
            if re.match(r"ADD\s+CONSTRAINT\b", item, re.I):
                continue
            judged = re.sub(r"\bIS\s+NOT\s+NULL\b", " ", item, flags=re.I)
            if NOT_NULL_ADD.search(judged) and not re.search(r"\bDEFAULT\b", item, re.I):
                out.append(("adds a NOT NULL column without a default", item[:140]))
    return out


def selftest() -> None:
    fine = [
        "CREATE TABLE t (id bigint);",
        "ALTER TABLE t ADD COLUMN c text;",
        "ALTER TABLE t ADD COLUMN c text NOT NULL DEFAULT '';",
        "ALTER TABLE t ADD COLUMN a text, ADD COLUMN b smallint NOT NULL DEFAULT 0;",
        "CREATE INDEX i ON t (c);",
        "DROP INDEX IF EXISTS i;",
        "ALTER TABLE t ADD CONSTRAINT x CHECK (c IS NULL OR c <> '');",
        # new nullable columns plus a CHECK that tests IS NOT NULL: purely additive (the legal_holds migration)
        "ALTER TABLE t ADD COLUMN a timestamptz, ADD COLUMN b bigint, ADD CONSTRAINT ck CHECK (b IS NULL OR a IS NOT NULL);",
        "ALTER TABLE t ADD CONSTRAINT ck CHECK (b IS NULL OR a IS NOT NULL);",
        "ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES u (id) ON DELETE SET NULL (a);",
    ]
    for sql in fine:
        assert not findings(sql), sql
    breaking = [
        "ALTER TABLE t DROP COLUMN c;",
        "DROP TABLE t;",
        "ALTER TABLE t RENAME COLUMN a TO b;",
        "ALTER TABLE t ALTER COLUMN c SET NOT NULL;",
        "ALTER TABLE t ALTER COLUMN c TYPE bigint;",
        "ALTER TYPE e ADD VALUE 'x';",
        "ALTER TABLE t ADD COLUMN c text NOT NULL;",
        "ALTER TABLE t ADD COLUMN a text, ADD COLUMN b text NOT NULL;",
        # a real NOT NULL column is still caught even when the statement also carries an IS NOT NULL test or a constraint
        "ALTER TABLE t ADD COLUMN b text NOT NULL, ADD CONSTRAINT ck CHECK (a IS NOT NULL);",
        "ALTER TABLE t ADD COLUMN c text CHECK (c IS NOT NULL OR a = 1) NOT NULL;",
        "DROP POLICY tenant_isolation ON t;",
        "TRUNCATE t;",
        "ALTER TABLE t DROP CONSTRAINT uq_t;",
    ]
    for sql in breaking:
        assert findings(sql), sql
    # a widen (drop, then add the same name) and a trigger refresh are replacements, not removals
    widen = "ALTER TABLE t DROP CONSTRAINT ck_t_c;\nALTER TABLE t ADD CONSTRAINT ck_t_c CHECK (c IN ('a','b','c'));"
    assert not findings(widen)
    refresh = "DROP TRIGGER trg_t_touch ON t;\nCREATE TRIGGER trg_t_touch BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION touch_row();"
    assert not findings(refresh)
    assert not findings("-- bluegreen-ok: removes the old column once the code stopped reading it\nALTER TABLE t DROP COLUMN c;")
    assert not findings("-- DROP TABLE t;\n/* TRUNCATE t; */ CREATE TABLE t (id bigint);")
    print("migration-lint selftest ok")


def main(paths) -> int:
    failed = 0
    for path in paths:
        with open(path, encoding="utf-8") as f:
            hits = findings(f.read())
        for name, stmt in hits:
            failed += 1
            print(f"{path}: {name}: {stmt}")
    if failed:
        print(f"{failed} statement(s) would break the live slot during a blue-green switch. Make the change expand-only, or add a "
              f"reviewed '-- bluegreen-ok: <why>' line to the file.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    sys.exit(main(sys.argv[1:]))
