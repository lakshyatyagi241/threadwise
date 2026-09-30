#!/usr/bin/env python3
"""Draft a Postgres migration for a WaDesk (MySQL/MariaDB) table, in this repo's conventions.

  mysql2pg_draft.py <table> [<table> ...]     read-only against the local WaDesk reference DB

Emits a DRAFT: tenant shape (org_id, bigint identity id, uuid, row_version, composite FKs, forced RLS,
touch_row trigger). Every judgement call is marked with '-- TODO' or '-- NOTE'. A human (with the
add-migration skill + check-rls.sh) must review it; it is a starting point, not a migration.

env: WADESK_DB_USER (wadesk) WADESK_DB_PASS (wadesk_local_pw) WADESK_DB_NAME (wadesk)
"""
import os, re, subprocess, sys, json

U = os.environ.get("WADESK_DB_USER", "wadesk")
P = os.environ.get("WADESK_DB_PASS", "wadesk_local_pw")
DB = os.environ.get("WADESK_DB_NAME", "wadesk")

SECRET_RX = re.compile(r"(token|secret|password|api_?key|credential|private_key|signing)", re.I)
JSONISH_RX = re.compile(r"(json|_data$|settings|config|meta|attributes|payload|options|params|extra|context|headers|body)", re.I)


def q(sql):
    r = subprocess.run(["mysql", f"-u{U}", f"-p{P}", DB, "-B", "-N", "-e", sql], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"mysql error: {r.stderr.strip()}")
    return [l.split("\t") for l in r.stdout.splitlines() if l != ""]


def tenant_tables():
    return {r[0] for r in q(f"select distinct table_name from information_schema.columns where table_schema='{DB}' and column_name='workspace_id'")}


def pg_type(col, table):
    name, ctype, dtype, null, default, extra = col["name"], col["ctype"], col["dtype"], col["null"], col["default"], col["extra"]
    notes = []
    m = re.match(r"(\w+)(?:\(([^)]*)\))?", ctype)
    unsigned = "unsigned" in ctype
    if dtype == "tinyint" and ctype.startswith("tinyint(1)"):
        t = "boolean"
    elif dtype in ("tinyint", "smallint"):
        t = "smallint"
    elif dtype in ("int", "mediumint"):
        t = "bigint" if unsigned else "integer"
    elif dtype == "bigint":
        t = "bigint"
    elif dtype == "decimal":
        t = f"numeric({m.group(2)})" if m and m.group(2) else "numeric"
        notes.append("money/amount: keep numeric, string end to end (ADR-0012)")
    elif dtype in ("float", "double"):
        t = "double precision"
        if re.search(r"(amount|price|total|balance|fee|cost|rate)", name):
            notes.append("TODO looks monetary: use numeric(p,s), never float")
    elif dtype in ("varchar",):
        t = f"varchar({m.group(2)})"
    elif dtype == "char":
        t = f"char({m.group(2)})"
    elif dtype in ("text", "mediumtext", "longtext", "tinytext"):
        t = "text"
        if dtype in ("longtext", "mediumtext", "text") and (JSONISH_RX.search(name) or dtype == "longtext"):
            try:
                v = q(f"select count(*), coalesce(sum(json_valid(`{name}`)),0) from (select `{name}` from `{table}` where `{name}` is not null and `{name}`<>'' limit 50) s")
                n, ok = int(v[0][0]), int(v[0][1])
                if n and n == ok:
                    t = "jsonb"; notes.append(f"NOTE jsonb: all {n} sampled rows are valid JSON; validate shape in the contract")
                elif n and ok:
                    notes.append(f"TODO mixed JSON/text in sample ({ok}/{n} valid JSON)")
                elif not n and JSONISH_RX.search(name):
                    notes.append("TODO no data to sample; name suggests JSON: confirm from the inventory/model casts, then use jsonb")
            except SystemExit:
                pass
    elif dtype == "json":
        t = "jsonb"
    elif dtype in ("datetime", "timestamp"):
        t = "timestamptz"
    elif dtype == "date":
        t = "date"
    elif dtype == "time":
        t = "time"
    elif dtype == "enum":
        vals = re.findall(r"'((?:[^']|'')*)'", ctype)
        t = "text"
        notes.append("CHECK " + ", ".join(vals))
        col["check"] = vals
    elif dtype in ("blob", "longblob", "mediumblob", "binary", "varbinary"):
        t = "bytea"
    else:
        t = "text"; notes.append(f"TODO unmapped MySQL type {ctype}")
    d = ""
    if default is not None and default != "NULL":
        dv = default.strip("'")
        if t == "boolean":
            d = " DEFAULT " + ("true" if dv in ("1", "true") else "false")
        elif t in ("smallint", "integer", "bigint") or t.startswith("numeric") or t == "double precision":
            d = f" DEFAULT {dv}" if re.fullmatch(r"-?\d+(\.\d+)?", dv) else ""
        elif dtype in ("datetime", "timestamp"):
            d = " DEFAULT now()" if "current_timestamp" in dv.lower() else ""
        elif t == "jsonb":
            d = ""
        elif dtype == "enum" or t.startswith(("varchar", "char", "text")):
            d = " DEFAULT '" + dv.replace("'", "''") + "'"
    if SECRET_RX.search(name):
        notes.append("TODO secret: AES-GCM encrypt at rest (provider-adapter credentials pattern), never plain")
    return t, d, notes


def draft(table, tenants):
    if not re.fullmatch(r"[a-z0-9_]+", table):
        sys.exit("bad table name")
    cols = []
    for r in q(f"select column_name, column_type, data_type, is_nullable, column_default, extra from information_schema.columns where table_schema='{DB}' and table_name='{table}' order by ordinal_position"):
        cols.append(dict(zip(["name", "ctype", "dtype", "null", "default", "extra"], r)))
    if not cols:
        sys.exit(f"table {table} not found in {DB}")
    names = {c["name"] for c in cols}
    scope = "tenant (workspace_id -> org_id)" if "workspace_id" in names else ("user-scoped (user_id): decide the owning workspace" if "user_id" in names else "global? (no workspace_id / user_id): if unsure it is tenant, default to tenant shape")
    fks = q(f"select k.column_name, k.referenced_table_name, k.referenced_column_name, r.delete_rule from information_schema.key_column_usage k join information_schema.referential_constraints r on r.constraint_name=k.constraint_name and r.constraint_schema=k.constraint_schema where k.table_schema='{DB}' and k.table_name='{table}' and k.referenced_table_name is not null")
    fkcols = {f[0]: f for f in fks}
    idx = {}
    for r in q(f"select index_name, non_unique, seq_in_index, column_name, index_type from information_schema.statistics where table_schema='{DB}' and table_name='{table}' order by index_name, seq_in_index"):
        idx.setdefault(r[0], {"unique": r[1] == "0", "cols": [], "type": r[4]})["cols"].append(r[3])

    L = [f"-- DRAFT for WaDesk table `{table}`  (scope: {scope})",
         "-- Generated by wadesk-data-model-port/scripts/mysql2pg_draft.py. Review every line, then use the add-migration skill",
         "-- (pnpm db:new <name>, check-rls.sh, Drizzle mirror in the same commit). Explain WHY in the header of the real file.", ""]
    items = [  # (sql fragment, comment); commas are added at render time so they never land inside a comment
        ("org_id      bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE", ""),
        ("id          bigint GENERATED BY DEFAULT AS IDENTITY", ""),
        ("uuid        uuid NOT NULL DEFAULT gen_random_uuid()", ""),
    ]
    skipped = []
    checks = []
    for c in cols:
        n = c["name"]
        if n in ("id", "workspace_id", "created_at", "updated_at"):
            continue
        if n == "deleted_at":
            skipped.append("deleted_at: WaDesk soft delete. Target is hard delete + audit row (ADR-0009); use is_archived/lifecycle only if the feature needs archive-in-place")
            continue
        t, d, notes = pg_type(c, table)
        nn = " NOT NULL" if c["null"] == "NO" and "auto_increment" not in c["extra"] else ""
        if n == "user_id" and "workspace_id" in names:
            notes.append("NOTE WaDesk user_id = owner/creator: map to users (org_id, id) staff pool")
        sql = f"{n.ljust(20)} {t}{nn}{d}"
        if n in fkcols:
            f = fkcols[n]
            ref, rule = f[1], f[3]
            if ref in tenants:
                act = {"CASCADE": "ON DELETE CASCADE", "SET NULL": f"ON DELETE SET NULL ({n})"}.get(rule, "")
                items.append((sql, " ".join(notes)))
                items.append((f"FOREIGN KEY (org_id, {n}) REFERENCES {ref} (org_id, id) {act}".rstrip(), "composite FK (never single-column to a tenant table)"))
                continue
            notes.append(f"NOTE FK to non-tenant table {ref}({f[2]}): confirm it is a global table or the users pool")
        elif n.endswith("_id") and n != "workspace_id":
            notes.append("TODO relation without a DB FK in WaDesk: decide the target table and add a composite FK if it is a real relation")
        items.append((sql, " ".join(notes)))
        if c.get("check"):
            vs = ", ".join("'" + v + "'" for v in c["check"])
            checks.append(f"CHECK ({n} IN ({vs}))")
    items += [("created_at  timestamptz NOT NULL DEFAULT now()", ""), ("updated_at  timestamptz NOT NULL DEFAULT now()", ""),
              ("row_version integer NOT NULL DEFAULT 1", ""), ("PRIMARY KEY (org_id, id)", ""), ("UNIQUE (org_id, uuid)", "")]
    for name, i in idx.items():
        if name == "PRIMARY" or not i["unique"]:
            continue
        cs = [c for c in i["cols"] if c != "workspace_id"]
        if cs:
            items.append((f"UNIQUE (org_id, {', '.join(cs)})", f"WaDesk unique key {name}"))
    for c in checks:
        items.append((c, "was a MySQL enum; append-only Postgres enum is the alternative (needs -- @no-transaction)"))
    L.append(f"CREATE TABLE {table} (")
    for k, (sql, cm) in enumerate(items):
        L.append("  " + sql + ("," if k < len(items) - 1 else "") + (f"  -- {cm}" if cm else ""))
    L.append(");")
    L.append("")
    seen_cols, seen_names = set(), set()
    for name, i in idx.items():
        if name == "PRIMARY" or i["unique"]:
            continue
        cs = [c for c in i["cols"] if c != "workspace_id"]
        if not cs:
            continue
        if i["type"] == "FULLTEXT":
            L.append(f"-- NOTE fulltext key {name} on ({', '.join(cs)}): use a GIN tsvector index or pg_trgm if the feature needs search")
            continue
        key = tuple(cs)
        if key in seen_cols:
            L.append(f"-- NOTE WaDesk key {name} duplicates an earlier index on ({', '.join(cs)}); skipped")
            continue
        seen_cols.add(key)
        base = f"idx_{table}_{'_'.join(cs)}"
        if len(base) > 60:
            base = base[:52] + "_" + format(abs(hash(base)) % 0xFFFFFF, "06x")
        nm, n = base, 2
        while nm in seen_names:
            nm = f"{base}_{n}"; n += 1
        seen_names.add(nm)
        L.append(f"CREATE INDEX {nm} ON {table} (org_id, {', '.join(cs)});  -- WaDesk key {name}")
    L += ["",
          f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;",
          f"ALTER TABLE {table} FORCE  ROW LEVEL SECURITY;",
          f"CREATE POLICY tenant_isolation ON {table} FOR ALL",
          "  USING      (org_id = current_org_id() OR app_is_privileged())",
          "  WITH CHECK (org_id = current_org_id() OR app_is_privileged());",
          "",
          f"CREATE TRIGGER trg_{table}_touch BEFORE UPDATE ON {table}",
          "  FOR EACH ROW EXECUTE FUNCTION touch_row();", ""]
    for s in skipped:
        L.append(f"-- NOTE skipped {s}")
    if any(n.endswith("_hash") for n in names):
        L.append("-- NOTE this table has *_hash columns: WaDesk stores PII encrypted plus a lookup hash. Decide encrypt-at-rest + hash vs plain under RLS; record it in an ADR if applied broadly.")
    if table in ("messages", "message_logs") or re.search(r"(_logs?|_events?|_history)$", table):
        L.append("-- NOTE looks like an append-only stream: consider RANGE partitioning by created_at (rule 7, copy 0006_outbox_audit.sql), no FK into it, retention = drop partition")
    return "\n".join(L)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    tenants = tenant_tables()
    for i, t in enumerate(sys.argv[1:]):
        if i:
            print("\n" + "-" * 78 + "\n")
        print(draft(t, tenants))


if __name__ == "__main__":
    main()
