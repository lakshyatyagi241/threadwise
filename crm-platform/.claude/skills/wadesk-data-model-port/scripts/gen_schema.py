#!/usr/bin/env python3
"""WaDesk (MySQL/MariaDB) schema -> crm-platform Postgres migrations + Drizzle schema + docs.

One internal model, three emitters, so SQL, Drizzle and the docs cannot disagree.

  gen_schema.py --out <dir>          write migrations/, schema/<domain>/, docs under <dir>   (default: ./out)
  gen_schema.py --report             print classification + unresolved references, write nothing

Inputs, in docs/wadesk-port/schema/source/ (or $SCHEMA_SRC): wadesk-schema.json (information_schema snapshot),
model-facts.json (Eloquent casts and relations, facts only), decisions.toml (every judgement call), review-overrides.json
(findings from reading WaDesk's code), target-columns.json (columns this repo already has), overlays/ (hand-written
additions to tables this repo already has). Nothing here copies WaDesk code, views, text or data.
Re-running is for comparing, not overwriting: write to a scratch --out and diff against the repo.
"""
import argparse, collections, datetime, hashlib, json, os, re, sys, tomllib

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))  # crm-platform/
# SCHEMA_SRC lets a scratch directory stand in for the committed inputs while iterating
SRC = os.environ.get("SCHEMA_SRC") or os.path.join(REPO, "docs", "wadesk-port", "schema", "source")
SCHEMA = json.load(open(os.path.join(SRC, "wadesk-schema.json")))
MODELS = json.load(open(os.path.join(SRC, "model-facts.json")))
DEC = tomllib.load(open(os.path.join(SRC, "decisions.toml"), "rb"))
OWN = json.load(open(os.environ.get("OWNERSHIP_JSON") or os.path.join(REPO, "docs", "wadesk-port", "ownership.json")))
_rv = os.path.join(SRC, "review-overrides.json")
REVIEW = json.load(open(_rv)) if os.path.exists(_rv) else {"relations": {}, "json": {}, "not_json": {}, "enum_hints": {}, "unique_hints": [], "notes": {}}
# reviewer findings (verified against the WaDesk source) apply first; anything in decisions.toml wins over them
for _k, _v in REVIEW["relations"].items():
    DEC.setdefault("relations", {}).setdefault(_k, _v)
for _sect in ("json", "not_json"):
    for _t, _cs in REVIEW[_sect].items():
        DEC.setdefault(_sect, {}).setdefault(_t, [])
        DEC[_sect][_t] = sorted(set(DEC[_sect][_t]) | set(_cs))
for _t, _v in DEC.get("stream_changes", {}).items():
    if _v == "regular":
        DEC["streams"].pop(_t, None)
    else:
        DEC["streams"][_t] = _v

PG_RESERVED = set("""all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate
collation column concurrently constraint create cross current_catalog current_date current_role current_schema current_time
current_timestamp current_user default deferrable desc distinct do else end except false fetch for foreign freeze from full grant
group having ilike in initially inner intersect into is isnull join lateral leading left like limit localtime localtimestamp natural
not notnull null offset on only or order outer overlaps placing primary references returning right select session_user similar some
symmetric table tablesample then to trailing true union unique user using variadic verbose when where window with""".split())

SECRET_RX = re.compile(r"(token|secret|password|api_?key|credential|private_key|signing|access_key)", re.I)
JSON_NAME_RX = re.compile(r"(_json$|^json_)", re.I)
USER_STEMS = {"user", "owner", "owner_user", "agent", "agent_user", "assignee", "assigned_to", "created_by", "updated_by", "added_by",
              "installed_by", "admin_user", "author_user", "referrer_user", "referred_user", "uploaded_by", "resolved_by", "actor"}

EXISTING_TARGET = {  # WaDesk table -> physical table in this repo that a FK to it must point at
    "users": "users", "workspaces": "organizations", "teams": "teams", "roles": "roles", "contacts": "contacts",
    "companies": "companies", "tags": "tags", "api_keys": "api_keys",
}
ALL_EXISTING = {  # tables that already exist (migrations 0001-0019 + auth_core): the generator must never create these
    "organizations", "users", "teams", "team_members", "permission_defs", "roles", "user_roles", "role_grants", "sequence_counters",
    "companies", "contacts", "contact_identities", "partner_agents", "partner_agent_leads", "api_keys", "event_outbox", "audit_log",
    "fields", "field_sections", "field_options", "field_dependencies", "field_option_dependencies", "status_options", "tags",
    "contact_tags", "contact_notes", "contact_views", "contact_view_favorites", "contact_files", "contact_activities", "contact_meetings",
    "user_security", "user_profiles", "user_avatars", "auth_sessions", "user_tokens", "social_identities", "platform_settings",
    "platform_operators", "platform_sessions", "security_events", "_migrations",
}


def snake_to_camel(s):
    parts = s.split("_")
    return parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:])


def snake_to_pascal(s):
    return "".join(p[:1].upper() + p[1:] for p in s.split("_"))


def short_name(base, limit=63):
    if len(base) <= limit:
        return base
    return base[: limit - 9] + "_" + hashlib.sha1(base.encode()).hexdigest()[:8]


def plural(w):
    if w.endswith("y") and len(w) > 1 and w[-2] not in "aeiou":
        return w[:-1] + "ies"
    if w.endswith(("s", "x", "ch", "sh")):
        return w + "es"
    return w + "s"


def qid(name):
    return f'"{name}"' if name in PG_RESERVED else name


# ---------------------------------------------------------------------------------------------------------------------
# virtual tables: tables that exist in the target but not as one WaDesk table (a split or a normalised JSON list)
# ---------------------------------------------------------------------------------------------------------------------
VIRTUAL = DEC.get("virtual", {})


def _colspec(name, ctype, nullable, pos, default=None):
    dt = ctype.split("(")[0].split(" ")[0]
    m = re.match(r"\w+\((\d+),(\d+)\)", ctype)
    return {"name": name, "ctype": ctype, "dtype": dt, "nullable": "YES" if nullable else "NO", "default": default, "extra": "", "comment": "",
            "maxlen": None, "prec": m.group(1) if m else None, "scale": m.group(2) if m else None, "pos": str(pos)}


VIRTUAL_CHECKS = {}
for _name, _spec in VIRTUAL.items():
    cols = [_colspec("id", "bigint(20) unsigned", False, 1)]
    if "from" in _spec:
        for c in SCHEMA[_spec["from"]]["columns"]:
            if c["name"] not in ("id", "workspace_id", "created_at", "updated_at", "deleted_at") and c["name"] not in _spec.get("skip", []):
                cols.append(dict(c))
    for c in _spec.get("columns", []):
        cols.append(_colspec(c["name"], c.get("ctype", "bigint(20) unsigned"), c.get("nullable", False), len(cols) + 1, c.get("default")))
    platform = _spec.get("class") in ("global_read", "platform_only")
    if not platform:
        cols.append(_colspec("workspace_id", "bigint(20) unsigned", False, len(cols) + 1))
    idx = {}
    if "from" in _spec:
        for nm, ix in SCHEMA[_spec["from"]]["indexes"].items():
            if nm != "PRIMARY":
                idx[f"src_{nm}"] = dict(ix)
    lead = [] if platform else ["workspace_id"]
    for i, (u, c) in enumerate([(True, x) for x in _spec.get("unique", [])] + [(False, x) for x in _spec.get("index", [])]):
        idx[f"virtual_{i}"] = {"unique": u, "type": "BTREE", "cols": lead + list(c)}
    SCHEMA[_name] = {"engine": "virtual", "rows_est": 0, "comment": _spec.get("why", ""), "columns": cols, "indexes": idx, "fks": []}
    VIRTUAL_CHECKS[_name] = _spec.get("checks", [])
    DEC["domain"].setdefault(_spec["domain"], [])
    DEC["domain"][_spec["domain"]].append(_name)
    if _spec.get("class") in ("global_read", "platform_only"):
        DEC["class"][_spec["class"]].append(_name)
    if _spec.get("stream_key"):
        DEC["streams"][_name] = _spec["stream_key"]

for _name, _spec in DEC.get("extra", {}).items():
    S = SCHEMA[_name]
    for c in _spec.get("columns", []):
        S["columns"].insert(len(S["columns"]) - 1, _colspec(c["name"], c.get("ctype", "text"), c.get("nullable", True), len(S["columns"]), c.get("default")))
    lead = ["workspace_id"] if any(c["name"] == "workspace_id" for c in S["columns"]) else []
    for i, c in enumerate(_spec.get("unique", [])):
        S["indexes"][f"extra_u{i}"] = {"unique": True, "type": "BTREE", "cols": lead + list(c)}
    for i, c in enumerate(_spec.get("index", [])):
        S["indexes"][f"extra_i{i}"] = {"unique": False, "type": "BTREE", "cols": lead + list(c)}

# ---------------------------------------------------------------------------------------------------------------------
# classification
# ---------------------------------------------------------------------------------------------------------------------
TABLE_DOMAIN = {t: d for d, ts in DEC["domain"].items() for t in ts}
DOMAINS = OWN["domains"]  # slug -> {code, owner, ...}
CLS = DEC["class"]
STREAMS = DEC["streams"]
HAS_WS = {t for t, v in SCHEMA.items() if any(c["name"] == "workspace_id" for c in v["columns"])}


def classify(t):
    if t in CLS["drop"]:
        return "drop"
    if t in CLS["existing"]:
        return "existing"
    if t in CLS["global_read"]:
        return "global_read"
    if t in CLS["platform_only"]:
        return "platform_only"
    if t in STREAMS:
        return "stream"
    return "tenant" if t in HAS_WS else "child"


KIND = {t: classify(t) for t in SCHEMA}
GENERATED = [t for t in SCHEMA if KIND[t] not in ("drop", "existing")]

# model lookups
TBL2MODEL = {m["table"]: (c, m) for c, m in MODELS.items()}
CLS2TBL = {c: m["table"] for c, m in MODELS.items()}


def casts_of(t):
    return TBL2MODEL[t][1]["casts"] if t in TBL2MODEL else {}


# ---------------------------------------------------------------------------------------------------------------------
# relation resolution: which *_id column points at which table
# ---------------------------------------------------------------------------------------------------------------------
def resolve_relations(t):
    """col -> (target wadesk table, source). Sources: db, model, hasMany, convention, override."""
    cols = [c["name"] for c in SCHEMA[t]["columns"]]   # table order, never a set: output must not depend on hash order
    rel = {}
    for fk in SCHEMA[t]["fks"]:
        if fk["col"] != "workspace_id":
            rel[fk["col"]] = (fk["ref_table"], "db")
    if t in TBL2MODEL:
        for r in TBL2MODEL[t][1]["relations"]:
            if r["kind"] == "belongsTo" and r.get("target_table"):
                fkcol = r["keys"][0] if r["keys"] else r["method"] + "_id"
                if fkcol in cols and fkcol not in rel:
                    rel[fkcol] = (r["target_table"], "model")
    # parent models that declare hasMany(thisModel, fk)
    for cname, m in MODELS.items():
        for r in m["relations"]:
            if r["kind"] in ("hasMany", "hasOne") and r.get("target_table") == t:
                fkcol = r["keys"][0] if r["keys"] else snake(cname) + "_id"
                if fkcol in cols and fkcol not in rel:
                    rel[fkcol] = (m["table"], "hasMany")
    ctypes = {c["name"]: c["dtype"] for c in SCHEMA[t]["columns"]}
    for c in cols:
        if c in rel or not c.endswith("_id") or c in ("workspace_id", "id"):
            continue
        if ctypes[c] not in ("bigint", "int", "mediumint", "smallint"):
            continue  # varchar *_id columns hold provider ids (facebook_id, meta_ad_id ...), not internal references
        stem = c[:-3]
        if stem in USER_STEMS or stem.endswith("_user"):
            rel[c] = ("users", "convention"); continue
        if stem == "parent":
            rel[c] = (t, "convention"); continue
        hit = None
        for cand in (plural(stem), stem, stem + "s"):
            if cand in SCHEMA and cand != t:
                hit = cand; break
        if hit is None:
            suffix = [x for x in SCHEMA if x.endswith("_" + plural(stem)) and x != t]
            if len(suffix) == 1:
                hit = suffix[0]
        if hit:
            rel[c] = (hit, "convention")
    for c in ("created_by", "updated_by", "added_by", "installed_by", "assigned_to", "uploaded_by", "resolved_by"):
        if c in cols and c not in rel:
            rel[c] = ("users", "convention")
    for c in list(rel):
        if ctypes[c] not in ("bigint", "int", "mediumint", "smallint"):
            del rel[c]  # a non-integer column is never an internal reference
    ov = DEC.get("relations", {})
    for key, tgt in ov.items():
        tt, cc = key.split(".")
        if tt == t and cc in cols:
            if tgt == "none":
                rel.pop(cc, None)
            else:
                rel[cc] = (tgt, "override")
    return rel


def snake(s):
    return re.sub(r"(?<!^)(?=[A-Z])", "_", s).lower()


# ---------------------------------------------------------------------------------------------------------------------
# column translation
# ---------------------------------------------------------------------------------------------------------------------
class Col:
    def __init__(self, name):
        self.name = name
        self.pg = "text"          # text bigint integer smallint boolean numeric double jsonb timestamptz date time bytea
        self.prec = None
        self.scale = None
        self.nullable = True
        self.default = None       # SQL literal or None
        self.check = None         # list of allowed values
        self.secret = False
        self.is_ref = False
        self.comment = ""
        self.notes = []


def pg_default(c, col):
    d = c["default"]
    if d in (None, "NULL"):
        return None
    d = d.strip()
    low = d.lower()
    if low.startswith("current_timestamp") or low in ("now()",):
        return "now()"
    raw = d[1:-1].replace("''", "'") if d.startswith("'") and d.endswith("'") else d
    if col.pg == "boolean":
        return "true" if raw in ("1", "true") else "false"
    if col.pg in ("bigint", "integer", "smallint", "double"):
        return raw if re.fullmatch(r"-?\d+(\.\d+)?", raw) else None
    if col.pg == "numeric":
        return raw if re.fullmatch(r"-?\d+(\.\d+)?", raw) else None
    if col.pg == "jsonb":
        return None
    if col.pg in ("timestamptz", "date", "time"):
        return None
    return "'" + raw.replace("'", "''") + "'"


def translate_column(t, c):
    col = Col(c["name"])
    col.nullable = c["nullable"] == "YES"
    col.comment = c["comment"] or ""
    ct, dt = c["ctype"], c["dtype"]
    unsigned = "unsigned" in ct
    cast = casts_of(t).get(c["name"], "")
    if dt == "tinyint" and ct.startswith("tinyint(1)"):
        col.pg = "boolean"
    elif dt in ("tinyint", "smallint"):
        col.pg = "smallint"
    elif dt in ("int", "mediumint"):
        col.pg = "bigint" if (c["name"].endswith("_id") or re.search(r"(bytes|size)$", c["name"])) else "integer"
        if unsigned is False and col.pg == "integer":
            col.pg = "integer"
    elif dt == "bigint":
        col.pg = "bigint"
    elif dt == "decimal":
        col.pg, col.prec, col.scale = "numeric", int(c["prec"]), int(c["scale"])
    elif dt in ("float", "double"):
        col.pg = "double"
        if re.search(r"(amount|price|total|balance|fee|cost|rate|credit)", c["name"]) and "minor" not in c["name"]:
            col.notes.append("float on a monetary-looking column: kept as double precision, review (money must be numeric)")
    elif dt in ("varchar", "char", "text", "mediumtext", "tinytext", "longtext"):
        col.pg = "text"
    elif dt == "json":
        col.pg = "jsonb"
    elif dt in ("datetime", "timestamp"):
        col.pg = "timestamptz"
    elif dt == "date":
        col.pg = "date"
    elif dt == "time":
        col.pg = "time"
    elif dt == "enum":
        col.pg = "text"
        col.check = re.findall(r"'((?:[^']|'')*)'", ct)
    elif dt in ("blob", "longblob", "mediumblob", "binary", "varbinary"):
        col.pg = "bytea"
    else:
        col.pg = "text"
        col.notes.append(f"unmapped MySQL type {ct}")
    # json
    json_over = DEC.get("json", {})
    is_json_cast = cast in ("array", "encrypted:array", "json", "object", "collection", "encrypted:json", "encrypted:object")
    force_json = c["name"] in json_over.get(t, [])
    force_text = c["name"] in DEC.get("not_json", {}).get(t, [])
    if col.pg == "text" and dt in ("longtext", "mediumtext", "text") and not force_text and (is_json_cast or JSON_NAME_RX.search(c["name"]) or force_json):
        col.pg = "jsonb"
    # secrets
    encrypted_cast = cast.startswith("encrypted")
    indexed = any(c["name"] in ix["cols"] for ix in SCHEMA[t]["indexes"].values())
    if indexed and SECRET_RX.search(c["name"]):
        col.notes.append("looked up by value (indexed in WaDesk): stored plain or as a hash, not ciphertext")
    elif (encrypted_cast and SECRET_RX.search(c["name"])) or (SECRET_RX.search(c["name"]) and not re.search(r"(hash|prefix|_at$|expires|count|type|status|mode|label)", c["name"]) and dt in ("text", "longtext", "varchar", "mediumtext")):
        col.secret = True
        col.pg = "text"
        col.notes.append("secret: AES-GCM ciphertext through the credential pattern, never plain")
    ov = DEC.get("column_type", {}).get(f"{t}.{c['name']}")
    if ov:
        m = re.fullmatch(r"decimal\((\d+),(\d+)\)", ov)
        if not m:
            sys.exit(f"column_type override {t}.{c['name']}: only decimal(p,s) is supported")
        col.pg, col.prec, col.scale = "numeric", int(m.group(1)), int(m.group(2))
    col.default = pg_default(c, col)
    if c["name"] in DEC.get("force_nullable", {}).get(t, []):
        col.nullable = True
    return col


# ---------------------------------------------------------------------------------------------------------------------
# internal model
# ---------------------------------------------------------------------------------------------------------------------
class Fk:
    def __init__(self, cols, target, target_cols, on_delete, name, plain=False, self_ref=False):
        self.cols, self.target, self.target_cols, self.on_delete, self.name = cols, target, target_cols, on_delete, name
        self.plain = plain
        self.self_ref = self_ref


class Table:
    def __init__(self, name):
        self.name = name
        self.kind = KIND[name]
        self.domain = TABLE_DOMAIN[name]
        self.cols = []            # Col, in order
        self.uniques = []         # (name, [cols])
        self.indexes = []         # (name, [cols])
        self.fks = []
        self.loose = []           # (col, reason)
        self.skipped = []         # (col, reason)
        self.partition_key = STREAMS.get(name)
        self.checks = list(VIRTUAL_CHECKS.get(name, []))   # [{name, sql}]
        self.parent = None
        self.rows_est = SCHEMA[name]["rows_est"]

    @property
    def tenant_scoped(self):
        return self.kind in ("tenant", "child", "stream")


TABLES = {}
ERRORS = []


def build():
    rels = {t: resolve_relations(t) for t in GENERATED}
    # 1) child parent column
    for t in GENERATED:
        tb = Table(t)
        TABLES[t] = tb
    for t in GENERATED:
        tb = TABLES[t]
        if tb.kind == "child":
            ov = DEC.get("parent", {}).get(t)
            if ov == "org":
                continue  # tenant-scoped by org_id alone: the natural parent is polymorphic or absent
            cand = []
            for col, (tgt, src) in rels[t].items():
                if col == ov:
                    cand = [(col, tgt)]; break
                if tgt in GENERATED and KIND[tgt] in ("tenant", "child") or tgt in EXISTING_TARGET and EXISTING_TARGET[tgt] not in ("organizations",):
                    cand.append((col, tgt))
            if not cand:
                ERRORS.append(f"child table {t} has no resolvable parent column: add [parent] {t} = '<col>' in decisions.toml (or classify it global)")
                continue
            # prefer db > model > hasMany > convention, and non-user parents over users
            order = {"db": 0, "model": 1, "hasMany": 2, "convention": 3, "override": -1}
            colpos = {c["name"]: i for i, c in enumerate(SCHEMA[t]["columns"])}

            def prefix_len(a, b):
                n = 0
                while n < min(len(a), len(b)) and a[n] == b[n]:
                    n += 1
                return n
            # users last; then the strongest evidence; then the target that is named like the child
            # (wechat_broadcast_recipients -> wechat_broadcasts); then column order
            cand.sort(key=lambda x: (x[1] == "users", order[rels[t][x[0]][1]], -prefix_len(t, x[1]), colpos[x[0]]))
            tb.parent = cand[0]
    # 2) columns, keys
    for t in GENERATED:
        tb = TABLES[t]
        S = SCHEMA[t]
        names = {c["name"] for c in S["columns"]}
        for c in S["columns"]:
            n = c["name"]
            if n in ("id", "workspace_id"):
                continue
            if n in ("created_at", "updated_at"):
                continue
            if n == "deleted_at":
                tb.skipped.append((n, "soft delete: hard delete + audit row (ADR-0009)"))
                continue
            if n in ("uuid", "row_version") or (n == "org_id" and tb.tenant_scoped):
                sys.exit(f"{t}.{n} collides with a platform column")
            tb.cols.append(translate_column(t, c))
        if tb.kind == "stream":
            pk = tb.partition_key
            if pk not in {c.name for c in tb.cols} and pk not in ("created_at",):
                sys.exit(f"stream {t}: partition key {pk} missing")
        # relations
        rl = rels[t]
        colmap = {c.name: c for c in tb.cols}
        for cname, (tgt, src) in sorted(rl.items(), key=lambda kv: [c["name"] for c in S["columns"]].index(kv[0])):
            col = colmap.get(cname)
            if col is None:
                continue
            col.is_ref = True
            col.pg = "bigint"
            tb_target = resolve_target(t, tb, cname, tgt, src)
            if tb_target is None:
                tb.loose.append((cname, f"{tgt} ({src}): no FK, target is a stream, dropped, or not reachable from this scope"))
                continue
            kind, phys = tb_target
            tb.fks.append(make_fk(tb, cname, kind, phys, tgt, src, col))
        # plain *_id columns not resolved at all
        for c in tb.cols:
            if c.name.endswith("_id") and not c.is_ref and c.pg in ("bigint", "integer", "smallint") and not c.secret:
                c.pg = "bigint"
                tb.loose.append((c.name, "no target table found: loose reference"))
                c.is_ref = True
        # keys
        seen = set()
        for nm, ix in S["indexes"].items():
            if nm == "PRIMARY":
                continue
            cs = [x for x in ix["cols"]]
            if ix["type"] == "FULLTEXT":
                continue
            rest = [x for x in cs if x != "workspace_id"]
            if not rest:
                continue
            if any(x in ("deleted_at",) for x in rest):
                continue
            rest = ["id" if False else x for x in rest]
            if any(x not in {c.name for c in tb.cols} and x not in ("created_at", "updated_at") for x in rest):
                continue
            has_ws = "workspace_id" in cs
            lead = ["org_id"] if tb.tenant_scoped else []
            if ix["unique"]:
                full = (["org_id"] + rest) if (has_ws and tb.tenant_scoped) else rest
                if tb.kind == "child" and not has_ws:
                    full = ["org_id"] + rest
                elif tb.tenant_scoped and not has_ws and not (len(rest) == 1 and f"{t}.{rest[0]}" in DEC["global_unique"]["keys"]):
                    full = ["org_id"] + rest   # tenant-owned values are unique per tenant; only the platform-issued ones below stay global
                key = ("u", tuple(full))
                if key in seen:
                    continue
                seen.add(key)
                if tb.kind == "stream":
                    continue  # unique keys cannot be enforced across partitions unless they include the partition key
                tb.uniques.append((short_name("uq_" + t + "_" + "_".join(rest)), full, "global" if (tb.tenant_scoped and full[0] != "org_id") else None))
            else:
                full = lead + rest
                key = ("i", tuple(full))
                if key in seen:
                    continue
                seen.add(key)
                tb.indexes.append((short_name("idx_" + t + "_" + "_".join(rest)), full))
        if VIRTUAL.get(t, {}).get("unique_org"):
            tb.uniques.append((short_name("uq_" + t + "_org"), ["org_id"], None))
        # drop indexes made redundant by a unique with the same leading columns
        uq_sets = [tuple(u[1]) for u in tb.uniques]
        tb.indexes = [ix for ix in tb.indexes if not any(tuple(ix[1]) == u[: len(ix[1])] for u in uq_sets)]
        # prefix-redundant indexes
        keep = []
        for ix in tb.indexes:
            if any(o is not ix and len(o[1]) > len(ix[1]) and o[1][: len(ix[1])] == ix[1] for o in tb.indexes):
                continue
            keep.append(ix)
        tb.indexes = keep


def resolve_target(t, tb, col, tgt, src):
    """Return ('self'|'existing'|'tenant'|'global'|'org', physical table) or None for loose."""
    if tb.kind == "stream":
        return None
    if tgt == t:
        return ("self", t) if tb.tenant_scoped or tb.kind in ("global_read", "platform_only") else None
    if tgt == "workspaces":
        return ("org", "organizations")
    if KIND.get(tgt) == "drop":
        return None
    if KIND.get(tgt) == "stream":
        return None
    if tgt in EXISTING_TARGET:
        phys = EXISTING_TARGET[tgt]
        if tb.kind in ("global_read", "platform_only"):
            return None
        return ("existing", phys)
    if KIND.get(tgt) == "existing":
        return None
    if tgt not in TABLES:
        return None
    k = KIND[tgt]
    if tb.kind in ("global_read", "platform_only"):
        return ("global", tgt) if k in ("global_read", "platform_only") else None
    if k in ("tenant", "child"):
        return ("tenant", tgt)
    if k in ("global_read", "platform_only"):
        return ("global", tgt)
    return None


def make_fk(tb, col, kind, phys, tgt, src, colobj):
    name = short_name(f"fk_{tb.name}_{col}")
    is_user = phys == "users"
    # ownership: the target model hasMany this table -> cascade; user refs and nullable refs -> set null; else restrict
    owns = src in ("hasMany",) or (tgt in MODELS_BY_TABLE and any(r["kind"] in ("hasMany", "hasOne") and r.get("target_table") == tb.name for r in MODELS_BY_TABLE[tgt]["relations"]))
    financial = DOMAINS[tb.domain]["code"] in DEC["meta"]["restrict_domains"]
    if tb.kind == "child" and tb.parent and tb.parent[0] == col and not is_user:
        rule = "CASCADE"
    elif is_user and tb.name in DEC["meta"].get("user_owned_cascade", []):
        rule = "CASCADE"   # per-user data that has no meaning once the user is gone (1:1 settings rows)
    elif is_user or colobj.nullable:
        rule = "SET NULL"
        colobj.nullable = True
    elif kind == "global":
        rule = "RESTRICT"
    elif financial:
        rule = "RESTRICT"
    else:
        rule = "CASCADE"
    db_rule = {"CASCADE": "CASCADE", "SET NULL": "SET NULL", "RESTRICT": "RESTRICT", "NO ACTION": "RESTRICT"}
    for fk in SCHEMA[tb.name]["fks"]:
        if fk["col"] == col and not (tb.kind == "child" and tb.parent and tb.parent[0] == col):
            rule = db_rule.get(fk["on_delete"], rule)
            if rule == "SET NULL":
                colobj.nullable = True
    if kind == "org":
        return Fk([col], "organizations", ["id"], rule if rule != "SET NULL" else "SET NULL", name, plain=True)
    if kind == "global":
        return Fk([col], phys, ["id"], rule, name, plain=True)
    if kind == "self":
        return Fk(["org_id", col], tb.name, ["org_id", "id"], "SET NULL" if colobj.nullable else rule, name, self_ref=True)
    return Fk(["org_id", col], phys, ["org_id", "id"], rule, name)


MODELS_BY_TABLE = {m["table"]: m for m in MODELS.values()}

# ---------------------------------------------------------------------------------------------------------------------
# ordering
# ---------------------------------------------------------------------------------------------------------------------
def domain_order(domains):
    deps = {d: collections.Counter() for d in domains}
    for tb in TABLES.values():
        for fk in tb.fks:
            if fk.target in TABLES and TABLES[fk.target].domain != tb.domain:
                deps[tb.domain][TABLES[fk.target].domain] += 1
    placed, remaining = [], list(domains)
    while remaining:
        def cost(d):
            return (sum(n for dd, n in deps[d].items() if dd not in placed and dd != d), remaining.index(d))
        best = min(remaining, key=cost)
        placed.append(best)
        remaining.remove(best)
    return placed


def table_order(domain):
    """topological order inside a domain; returns (ordered tables, back-edge fks to add afterwards)"""
    tabs = [t for t in TABLES.values() if t.domain == domain]
    names = {t.name for t in tabs}
    order, done, deferred = [], set(), []
    pending = list(tabs)
    while pending:
        progressed = False
        for tb in list(pending):
            need = {fk.target for fk in tb.fks if fk.target in names and fk.target != tb.name}
            if need <= done:
                order.append(tb); done.add(tb.name); pending.remove(tb); progressed = True
        if not progressed:  # cycle: break by deferring the FKs of the first pending table that point at pending tables
            tb = pending[0]
            for fk in list(tb.fks):
                if fk.target in names and fk.target != tb.name and fk.target not in done:
                    deferred.append((tb, fk))
                    tb.fks.remove(fk)
    return order, deferred


# ---------------------------------------------------------------------------------------------------------------------
# emitters
# ---------------------------------------------------------------------------------------------------------------------
def sql_type(c):
    if c.pg == "numeric":
        return f"numeric({c.prec},{c.scale})"
    return {"double": "double precision", "timestamptz": "timestamptz"}.get(c.pg, c.pg)


def sql_for_table(tb, inline_fks):
    L = []
    t = tb.name
    pk_note = f"-- WaDesk `{t}` ({tb.kind}; {tb.rows_est} rows in the reference DB)"
    L.append(pk_note)
    cols = []
    if tb.kind == "stream":
        L.append(f"CREATE SEQUENCE {t}_id_seq;")
        cols.append(f"id bigint NOT NULL DEFAULT nextval('{t}_id_seq')")
        cols.append("org_id bigint NOT NULL")
    elif tb.tenant_scoped:
        cols.append("org_id bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE")
        cols.append("id bigint GENERATED BY DEFAULT AS IDENTITY")
        cols.append("uuid uuid NOT NULL DEFAULT gen_random_uuid()")
    else:
        cols.append("id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY")
        cols.append("uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid()")
    cons = []
    own_cols = []
    for c in tb.cols:
        s = f"{qid(c.name)} {sql_type(c)}"
        if not c.nullable:
            s += " NOT NULL"
        if c.default is not None:
            s += f" DEFAULT {c.default}"
        cm = []
        if c.secret:
            cm.append("encrypted")
        if c.comment:
            cm.append(c.comment.replace("\n", " "))
        own_cols.append((s, " ".join(cm)))
    has_created = True
    if tb.kind == "stream":
        pkc = tb.partition_key
        if pkc == "created_at":
            own_cols.append(("created_at timestamptz NOT NULL DEFAULT now()", ""))
        else:
            # natural event time column: make it NOT NULL default now() since it is the partition key
            for i, (s, cm) in enumerate(own_cols):
                if s.startswith(qid(pkc) + " "):
                    own_cols[i] = (f"{qid(pkc)} timestamptz NOT NULL DEFAULT now()", cm)
            own_cols.append(("created_at timestamptz NOT NULL DEFAULT now()", ""))
    else:
        own_cols.append(("created_at timestamptz NOT NULL DEFAULT now()", ""))
        own_cols.append(("updated_at timestamptz NOT NULL DEFAULT now()", ""))
        own_cols.append(("row_version integer NOT NULL DEFAULT 1", ""))
    if tb.kind == "stream":
        cons.append(f"PRIMARY KEY (id, {qid(tb.partition_key)})")
    elif tb.tenant_scoped:
        cons.append("PRIMARY KEY (org_id, id)")
        cons.append("UNIQUE (org_id, uuid)")
    for c in tb.cols:
        if c.check:
            vals = ", ".join("'" + v.replace("'", "''") + "'" for v in c.check)
            cons.append(f"CONSTRAINT {short_name('chk_' + t + '_' + c.name)} CHECK ({qid(c.name)} IN ({vals}))")
    for ck in tb.checks:
        cons.append(f"CONSTRAINT {ck['name']} CHECK ({ck['sql']})")
    for nm, cs, _g in tb.uniques:
        cons.append(f"CONSTRAINT {nm} UNIQUE ({', '.join(qid(x) for x in cs)})")
    for fk in inline_fks:
        cons.append(fk_sql(fk))
    items = [(s, cm) for s, cm in [(x, "") for x in cols]] + own_cols + [(x, "") for x in cons]
    L.append(f"CREATE TABLE {t} (")
    for i, (s, cm) in enumerate(items):
        L.append("  " + s + ("," if i < len(items) - 1 else "") + (f"  -- {cm}" if cm else ""))
    if tb.kind == "stream":
        L.append(f") PARTITION BY RANGE ({qid(tb.partition_key)});")
    else:
        L.append(");")
    for nm, cs in tb.indexes:
        L.append(f"CREATE INDEX {nm} ON {t} ({', '.join(qid(x) for x in cs)});")
    return "\n".join(L)


def fk_sql(fk):
    cols = ", ".join(qid(x) for x in fk.cols)
    tcols = ", ".join(qid(x) for x in fk.target_cols)
    act = ""
    if fk.on_delete == "CASCADE":
        act = " ON DELETE CASCADE"
    elif fk.on_delete == "RESTRICT":
        act = " ON DELETE RESTRICT"
    elif fk.on_delete == "SET NULL":
        act = f" ON DELETE SET NULL ({qid(fk.cols[-1])})" if not fk.plain else " ON DELETE SET NULL"
    return f"CONSTRAINT {fk.name} FOREIGN KEY ({cols}) REFERENCES {fk.target} ({tcols}){act}"


def rls_sql(tb):
    t = tb.name
    L = []
    if tb.kind in ("global_read", "platform_only"):
        L.append(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;")
        L.append(f"ALTER TABLE {t} FORCE  ROW LEVEL SECURITY;")
        if tb.kind == "global_read":
            L.append(f"CREATE POLICY read_all ON {t} FOR SELECT USING (true);")
        L.append(f"CREATE POLICY operator_write ON {t} FOR ALL")
        L.append("  USING      (app_is_privileged())")
        L.append("  WITH CHECK (app_is_privileged());")
    else:
        L.append(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;")
        L.append(f"ALTER TABLE {t} FORCE  ROW LEVEL SECURITY;")
        L.append(f"CREATE POLICY tenant_isolation ON {t} FOR ALL")
        L.append("  USING      (org_id = current_org_id() OR app_is_privileged())")
        L.append("  WITH CHECK (org_id = current_org_id() OR app_is_privileged());")
    if tb.kind != "stream":
        L.append(f"CREATE TRIGGER trg_{t}_touch BEFORE UPDATE ON {t}")
        L.append("  FOR EACH ROW EXECUTE FUNCTION touch_row();")
    return "\n".join(L)


def partition_sql(streams):
    L = ["DO $$", "DECLARE", "  m date;", "BEGIN", "  FOR m IN",
         f"    SELECT generate_series(date_trunc('month', now() - interval '{DEC['meta']['partition_months_back']} month'),",
         f"      date_trunc('month', now() + interval '{DEC['meta']['partition_months_ahead']} months'), interval '1 month')::date",
         "  LOOP"]
    for t in streams:
        L.append(f"    PERFORM ensure_monthly_partition('{t}', m);")
    L += ["  END LOOP;", "END $$;"]
    for t in streams:
        L.append(f"CREATE TABLE {t}_default PARTITION OF {t} DEFAULT;")
    return "\n".join(L)


def migration_sql(domain, order, deferred, incoming, overlay_sql):
    code = DOMAINS[domain]["code"]
    names = [t.name for t in order]
    L = [f"-- {code}: {domain} data model, ported from WaDesk",
         "-- Why this migration exists: the tables WaDesk's " + domain.replace("-", " ") + " features read and write, translated to this",
         "-- repo's tenancy shape (org_id first, composite FKs, forced RLS, hard delete, touch_row) so the port starts from a",
         "-- complete schema instead of each feature inventing its own. Translation rules and every judgement call:",
         "-- docs/wadesk-port/schema/README.md and docs/wadesk-port/schema/decisions.toml.",
         "--", f"-- Tables: {', '.join(names) if names else '(none: overlay only)'}", ""]
    if overlay_sql:
        L += ["-- --- additions to tables this repo already has ----------------------------------------", overlay_sql.strip(), ""]
    streams = [t.name for t in order if t.kind == "stream"]
    for tb in order:
        L.append(sql_for_table(tb, tb.fks_inline))
        L.append("")
        L.append(rls_sql(tb))
        L.append("")
    if streams:
        L.append("-- Bootstrap partitions (previous month, current, next two) and a catch-all so a gap in partition")
        L.append("-- maintenance degrades into rows landing in _default instead of failed writes. Add each parent to")
        L.append("-- PARTITIONED_TABLES in apps/api/src/workers/partition-maintenance.service.ts.")
        L.append(partition_sql(streams))
        L.append("")
    for tb, fk in deferred:
        L.append(f"ALTER TABLE {tb.name} ADD {fk_sql(fk)};")
    for tb, fk in incoming:
        L.append(f"-- foreign key from {tb.domain} ({DOMAINS[tb.domain]['code']}), whose migration runs earlier than this table exists")
        L.append(f"ALTER TABLE {tb.name} ADD {fk_sql(fk)};")
    return "\n".join(L).rstrip() + "\n"


# --- drizzle -----------------------------------------------------------------------------------------------------------
def ts_col(c):
    n = c.name
    prop = snake_to_camel(n)
    if c.pg == "bigint":
        base = f"idColumn('{n}')" if c.is_ref else f"bigint('{n}', {{ mode: 'number' }})"
    elif c.pg == "integer":
        base = f"integer('{n}')"
    elif c.pg == "smallint":
        base = f"smallint('{n}')"
    elif c.pg == "boolean":
        base = f"boolean('{n}')"
    elif c.pg == "numeric":
        base = f"numeric('{n}', {{ precision: {c.prec}, scale: {c.scale} }})"
    elif c.pg == "double":
        base = f"doublePrecision('{n}')"
    elif c.pg == "jsonb":
        base = f"jsonb('{n}')"
    elif c.pg == "timestamptz":
        base = f"timestamp('{n}', {{ withTimezone: true }})"
    elif c.pg == "date":
        base = f"date('{n}')"
    elif c.pg == "time":
        base = f"time('{n}')"
    elif c.pg == "bytea":
        base = f"bytea('{n}')"
    else:
        base = f"text('{n}')"
    if not c.nullable:
        base += ".notNull()"
    if c.default is not None:
        d = c.default
        if d == "now()":
            base += ".defaultNow()"
        elif c.pg == "boolean":
            base += f".default({d})"
        elif c.pg in ("bigint", "integer", "smallint", "double"):
            base += f".default({d})"
        elif c.pg == "numeric":
            base += f".default('{d}')"
        else:
            base += ".default(" + json.dumps(d[1:-1].replace("''", "'")) + ")"
    return prop, base


TS_NAMES = {}


def ts_table_name(t):
    n = snake_to_camel(t)
    return n


def emit_ts(domain, order, imports_from):
    L = ["import {", "  bigint,", "  boolean,", "  check,", "  date,", "  doublePrecision,", "  foreignKey,", "  index,", "  integer,", "  jsonb,", "  numeric,",
         "  pgTable,", "  primaryKey,", "  smallint,", "  sql,", "  text,", "  time,", "  timestamp,", "  unique,", "  uuid,", "} from 'drizzle-orm/pg-core';"]
    # imports are trimmed later by eslint --fix if unused; keep deterministic list
    return L


def render_domain_ts(domain, order, all_fks_by_table):
    used = {"pgTable"}
    body = []
    ext_imports = collections.defaultdict(set)  # module path -> names
    local = {t.name for t in order}
    for tb in order:
        t = tb.name
        ex = ts_table_name(t)
        cols = []
        if tb.kind == "stream":
            cols.append("    id: bigint('id', { mode: 'number' }).notNull().default(sql`nextval('" + t + "_id_seq')`),")
            cols.append("    orgId: orgIdColumn(),")
            used.update({"bigint", "sql"})
            ext_imports["../columns"].add("orgIdColumn")
        elif tb.tenant_scoped:
            cols.append("    orgId: orgIdColumn(),")
            cols.append("    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),")
            cols.append("    uuid: uuid('uuid').notNull().defaultRandom(),")
            ext_imports["../columns"].update({"orgIdColumn", "idColumn"})
            used.add("uuid")
        else:
            cols.append("    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),")
            cols.append("    uuid: uuid('uuid').notNull().unique().defaultRandom(),")
            ext_imports["../columns"].add("idColumn")
            used.add("uuid")
        pkcol = tb.partition_key
        for c in tb.cols:
            prop, base = ts_col(c)
            if tb.kind == "stream" and c.name == pkcol:
                base = f"timestamp('{c.name}', {{ withTimezone: true }}).notNull().defaultNow()"
            if c.pg == "bigint":
                if c.is_ref:
                    ext_imports["../columns"].add("idColumn")
                else:
                    used.add("bigint")
            used.add({"integer": "integer", "smallint": "smallint", "boolean": "boolean", "numeric": "numeric", "double": "doublePrecision",
                      "jsonb": "jsonb", "timestamptz": "timestamp", "date": "date", "time": "time", "text": "text"}.get(c.pg, "text"))
            if c.pg == "bytea":
                used.add("customType")
            doc = ""
            if c.secret:
                doc = "    /** AES-GCM ciphertext (credential pattern); never plain text. */\n"
            elif c.comment:
                doc = f"    /** {c.comment.replace('*/', '')} */\n"
            cols.append(f"{doc}    {prop}: {base},")
        if tb.kind == "stream":
            if pkcol == "created_at":
                cols.append("    createdAt: createdAt(),")
                ext_imports["../columns"].add("createdAt")
            else:
                cols.append("    createdAt: createdAt(),")
                ext_imports["../columns"].add("createdAt")
        else:
            cols += ["    createdAt: createdAt(),", "    updatedAt: updatedAt(),", "    rowVersion: rowVersion(),"]
            ext_imports["../columns"].update({"createdAt", "updatedAt", "rowVersion"})
        extra = []
        if tb.kind == "stream":
            extra.append(f"    primaryKey({{ columns: [t.id, t.{snake_to_camel(pkcol)}] }}),")
            used.add("primaryKey")
        elif tb.tenant_scoped:
            extra.append("    primaryKey({ columns: [t.orgId, t.id] }),")
            extra.append(f"    unique('{short_name('uq_' + t + '_org_id_uuid')}').on(t.orgId, t.uuid),")
            used.update({"primaryKey", "unique"})
            ext_imports["../foundation"].add("organizations")
            extra.append(f"    foreignKey({{ name: '{short_name('fk_' + t + '_org')}', columns: [t.orgId], foreignColumns: [organizations.id] }}).onDelete('cascade'),")
            used.add("foreignKey")
        for c in tb.cols:
            if c.check:
                vals = ", ".join("'" + v.replace("'", "\\'") + "'" for v in c.check)
                extra.append(f"    check('{short_name('chk_' + t + '_' + c.name)}', sql`${{t.{snake_to_camel(c.name)}}} in ({', '.join(chr(39) + v.replace(chr(39), chr(39)*2) + chr(39) for v in c.check)})`),")
                used.update({"check", "sql"})
        for ck in tb.checks:
            extra.append(f"    check('{ck['name']}', sql.raw({json.dumps(ck['sql'])})),")
            used.update({"check", "sql"})
        for nm, cs, _g in tb.uniques:
            extra.append(f"    unique('{nm}').on({', '.join('t.' + snake_to_camel(x) for x in cs)}),")
            used.add("unique")
        for fk in tb.fks:
            if fk.target == t:
                tgtref = "t"  # self reference: use the callback's table, naming the const here makes TS infer any
            elif fk.target in TABLES:
                tgtref = ts_table_name(fk.target)
                if fk.target not in local:
                    ext_imports[f"../{TABLES[fk.target].domain}/tables"].add(tgtref)
            else:
                tgtref = ts_table_name(fk.target)
                ext_imports["../foundation" if fk.target in ("organizations", "users", "teams", "roles") else "../crm" if fk.target in ("contacts", "companies") else "../contact-views" if fk.target in ("tags",) else "../partner"].add(tgtref)
            cols_ts = ", ".join("t." + snake_to_camel(x) for x in fk.cols)
            tcols_ts = ", ".join(f"{tgtref}." + snake_to_camel(x) for x in fk.target_cols)
            act = {"CASCADE": ".onDelete('cascade')", "SET NULL": ".onDelete('set null')", "RESTRICT": ".onDelete('restrict')"}[fk.on_delete]
            extra.append(f"    foreignKey({{ name: '{fk.name}', columns: [{cols_ts}], foreignColumns: [{tcols_ts}] }}){act},")
            used.add("foreignKey")
        for nm, cs in tb.indexes:
            extra.append(f"    index('{nm}').on({', '.join('t.' + snake_to_camel(x) for x in cs)}),")
            used.add("index")
        pas = snake_to_pascal(t)
        tail = ("  (t) => [\n" + "\n".join(extra) + "\n  ],\n") if extra else ""
        body.append(f"export const {ex} = pgTable(\n  '{t}',\n  {{\n" + "\n".join(cols) + "\n  }" + (",\n" + tail if tail else ",\n") + ");\n")
        body.append(f"export type {pas}Row = typeof {ex}.$inferSelect;\nexport type New{pas}Row = typeof {ex}.$inferInsert;\n")
    return body, used, ext_imports



# ---------------------------------------------------------------------------------------------------------------------
# docs
# ---------------------------------------------------------------------------------------------------------------------
TARGET_COLS = json.load(open(os.path.join(SRC, "target-columns.json"))) if os.path.exists(os.path.join(SRC, "target-columns.json")) else {}


def map_column(t, c):
    m = DEC.get("map", {}).get(t, {})
    if c in m:
        return m[c]
    if "_default" in m:
        return m["_default"].replace("<same column>", c)
    target = re.split(r"[ (+]", CLS["existing"].get(t, ""))[0] if t in CLS["existing"] else None
    if c == "workspace_id" and target:
        return f"{target}.org_id"
    if target and c in TARGET_COLS.get(target, []):
        return f"{target}.{c}"
    return "UNMAPPED"


def emit_docs(out, order_d, manifest):
    dd = os.path.join(out, "docs", "wadesk-port", "schema")
    os.makedirs(dd, exist_ok=True)
    mig = {m[0]: m[1] for m in manifest}
    L = ["# WaDesk table map", "", "Generated by `.claude/skills/wadesk-data-model-port/scripts/gen_schema.py` from the WaDesk reference schema and `decisions.toml`.",
         "Do not edit by hand: change `docs/wadesk-port/schema/source/decisions.toml` and regenerate into a scratch directory to compare.", ""]
    kinds = collections.Counter(KIND[t] for t in SCHEMA if t in KIND and SCHEMA[t]["engine"] != "virtual")
    L += ["| class | WaDesk tables | meaning |", "| --- | --- | --- |"]
    meaning = {"tenant": "has `workspace_id`: becomes a tenant table (`org_id`, composite FKs, forced RLS)", "child": "no `workspace_id`; tenancy inherited from a parent row (`org_id` added, composite FK to the parent)",
               "stream": "append-only high-volume log: monthly RANGE partition, no FKs", "global_read": "platform catalogue, no `org_id`, readable by every tenant, written only by the privileged role",
               "platform_only": "platform-operator data, no `org_id`, invisible to tenant transactions", "existing": "the same thing as a table this repo already has: not created, mapped",
               "drop": "Laravel plumbing replaced by the platform"}
    for k in ("tenant", "child", "stream", "global_read", "platform_only", "existing", "drop"):
        L.append(f"| {k} | {kinds.get(k, 0)} | {meaning[k]} |")
    L += ["", f"Plus {len(VIRTUAL)} tables that do not exist as one WaDesk table (see Virtual tables).", "", "## Every WaDesk table", "",
          "| WaDesk table | becomes | class | domain | owner | WaDesk cols | FKs | loose refs |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for t in sorted(t for t in SCHEMA if SCHEMA[t]["engine"] != "virtual"):
        dom = TABLE_DOMAIN[t]; code = DOMAINS[dom]["code"]; owner = DOMAINS[dom]["owner"]
        k = KIND[t]
        if k == "drop":
            becomes = f"dropped: {CLS['drop'][t]}"; fk = loose = "-"
        elif k == "existing":
            becomes = f"mapped to {CLS['existing'][t]}"; fk = loose = "-"
        else:
            tb = TABLES[t]
            becomes = f"`{t}` ({mig.get(dom, '')})"; fk = len(tb.fks) + sum(1 for x in tb.__dict__.get("deferred", []))
            fk = sum(1 for f in ALL_FKS.get(t, [])); loose = len(tb.loose)
        L.append(f"| `{t}` | {becomes} | {k} | {code} | {owner} | {len(SCHEMA[t]['columns'])} | {fk} | {loose} |")
    L += ["", "## Virtual tables", "", "| table | domain | built from | why |", "| --- | --- | --- | --- |"]
    for n, sp in VIRTUAL.items():
        L.append(f"| `{n}` | {DOMAINS[sp['domain']]['code']} | {('WaDesk `' + sp['from'] + '`') if 'from' in sp else 'new'} | {sp.get('why', '')} |")
    L += ["", "## Column maps for tables that already exist here", ""]
    unmapped = []
    for t in sorted(CLS["existing"]):
        L += [f"### `{t}` -> {CLS['existing'][t]}", "", "| WaDesk column | lives in |", "| --- | --- |"]
        for c in SCHEMA[t]["columns"]:
            v = map_column(t, c["name"])
            if v == "UNMAPPED":
                unmapped.append(f"{t}.{c['name']}")
            L.append(f"| `{c['name']}` | {v} |")
        L.append("")
    open(os.path.join(dd, "table-map.md"), "w").write("\n".join(L))
    if unmapped:
        print("UNMAPPED columns:", unmapped)

    # review notes
    R = ["# Schema review notes", "", "Generated. Everything a person has to look at after the mechanical translation: references without a foreign key, secrets, JSON shapes,",
         "global uniques, and what the reviewers found by reading WaDesk's code. Domain owners work through their own tables.", ""]
    R += ["## Loose references (no foreign key)", "",
          "A numeric `*_id` column that stays a plain `bigint`: polymorphic, a provider id, a stream (no FKs in streams), a platform table pointing at a tenant table, or a target that is not a table here.", "",
          "| table | column | domain | why |", "| --- | --- | --- | --- |"]
    for tb in sorted(TABLES.values(), key=lambda x: (x.domain, x.name)):
        for c, why in tb.loose:
            R.append(f"| `{tb.name}` | `{c}` | {DOMAINS[tb.domain]['code']} | {why} |")
    R += ["", "## Streams (monthly partitions)", "", "Add each to `PARTITIONED_TABLES` in `apps/api/src/workers/partition-maintenance.service.ts` (or make that list discover `pg_partitioned_table`): until then they only have the bootstrap partitions and `_default`.", ""]
    for tb in sorted(TABLES.values(), key=lambda x: x.name):
        if tb.kind == "stream":
            R.append(f"- `{tb.name}` (partition key `{tb.partition_key}`, domain {DOMAINS[tb.domain]['code']})")
    R += ["", "## Secret columns (ciphertext, never plain)", "", "Stored as `text`. The application encrypts and decrypts through the credential pattern (AES-GCM); the database cannot check it.", ""]
    for tb in sorted(TABLES.values(), key=lambda x: x.name):
        sc = [c.name for c in tb.cols if c.secret]
        if sc:
            R.append(f"- `{tb.name}`: {', '.join('`' + x + '`' for x in sc)}")
    R += ["", "## JSON columns (shape still to be defined)", "", "`jsonb` is storage only. WaDesk never validated these. Each needs a Zod schema in `@crm/contracts` before a feature relies on its shape.", ""]
    for tb in sorted(TABLES.values(), key=lambda x: x.name):
        jc = [c.name for c in tb.cols if c.pg == "jsonb"]
        if jc:
            R.append(f"- `{tb.name}`: {', '.join('`' + x + '`' for x in jc)}")
    R += ["", "## Uniqueness that is not per tenant", "", "A WaDesk unique key without `workspace_id` stays global (it is stricter, and some are looked up before a tenant is known).", ""]
    for tb in sorted(TABLES.values(), key=lambda x: x.name):
        for nm, cs, g in tb.uniques:
            if g == "global":
                R.append(f"- `{tb.name}`: `{nm}` on ({', '.join(cs)})")
    R += ["", "## Soft deletes dropped", "", "WaDesk soft-deletes these tables; here a delete is a hard delete plus an audit row (ADR-0009). If a feature needs restore, add `is_archived` for that table.", ""]
    for tb in sorted(TABLES.values(), key=lambda x: x.name):
        if any(c == "deleted_at" for c, _ in tb.skipped):
            R.append(f"- `{tb.name}`")
    for t in ("workspaces", "teams", "users"):
        if any(c["name"] == "deleted_at" for c in SCHEMA[t]["columns"]):
            R.append(f"- `{t}` (mapped to an existing table)")
    R += ["", "## Reviewer findings from reading WaDesk's code", "", "Verified against the WaDesk source by reading models, controllers, services and the Node bridge. Facts only.", ""]
    R += ["### Enum-like columns (closed value sets found in code)", "", "Not enforced by a CHECK: values were gathered from validation rules and constants, and WaDesk's own data may hold others. Add a CHECK when the feature is ported and the set is confirmed.", ""]
    for k, v in sorted(REVIEW.get("enum_hints", {}).items()):
        R.append(f"- `{k}`: {', '.join(str(x) for x in v)}")
    R += ["", "### Uniqueness the application enforces without a database key", ""]
    for u in REVIEW.get("unique_hints", []):
        R.append(f"- `{u['table']}` ({', '.join(u['columns'])}): {u['why']}")
    R += ["", "### Notes per table", ""]
    for t, ns in sorted(REVIEW.get("notes", {}).items()):
        R.append(f"**`{t}`**")
        for n in ns:
            R.append(f"- {n}")
        R.append("")
    open(os.path.join(dd, "review-notes.md"), "w").write("\n".join(R))
    emit_dbml(out, order_d)


def emit_dbml(out, order_d):
    dd = os.path.join(out, "docs", "db")
    os.makedirs(dd, exist_ok=True)
    def ty(c):
        t = sql_type(c)
        return f'"{t}"' if " " in t else t
    L = ["// Generated from the same model as the migrations and the Drizzle schema (gen_schema.py).", "// Paste into dbdiagram.io. Every tenant table also has org_id -> organizations.id; those refs are left out to keep the picture readable.",
         "// Tables this repo already had are drawn as stubs (only the key columns), see docs/db/README.md for their full shape.", ""]
    stubs = set()
    refs = []
    groups = collections.defaultdict(list)
    for d in order_d:
        for tb in sorted([x for x in TABLES.values() if x.domain == d], key=lambda x: x.name):
            groups[d].append(tb.name)
            L.append(f"Table {tb.name} {{")
            if tb.kind == "stream":
                L.append("  id bigint [not null]")
                L.append("  org_id bigint [not null]")
            elif tb.tenant_scoped:
                L.append("  org_id bigint [not null]")
                L.append("  id bigint [not null]")
                L.append("  uuid uuid [not null]")
            else:
                L.append("  id bigint [pk, increment]")
                L.append("  uuid uuid [not null, unique]")
            for c in tb.cols:
                attrs = []
                if not c.nullable:
                    attrs.append("not null")
                if c.default is not None:
                    attrs.append(f"default: `{c.default}`")
                if c.secret:
                    attrs.append("note: 'ciphertext'")
                L.append(f"  {c.name} {ty(c)}" + (f" [{', '.join(attrs)}]" if attrs else ""))
            if tb.kind == "stream":
                L.append(f"  created_at timestamptz [not null]")
            else:
                L += ["  created_at timestamptz [not null]", "  updated_at timestamptz [not null]", "  row_version integer [not null, default: 1]"]
            ix = []
            if tb.kind == "stream":
                ix.append(f"(id, {tb.partition_key}) [pk]")
            elif tb.tenant_scoped:
                ix += ["(org_id, id) [pk]", "(org_id, uuid) [unique]"]
            for nm, cs, _g in tb.uniques:
                ix.append(f"({', '.join(cs)}) [unique]")
            for nm, cs in tb.indexes:
                ix.append(f"({', '.join(cs)})")
            if ix:
                L.append("  indexes {")
                L += [f"    {x}" for x in ix]
                L.append("  }")
            if tb.kind == "stream":
                L.append("  Note: 'append-only stream, monthly partitions, no foreign keys'")
            L += ["}", ""]
    for fk in ALL_FKS_LIST:
        tb, f = fk
        if f.target == "organizations":
            continue
        if f.target not in TABLES:
            stubs.add(f.target)
        a = f"{tb.name}.{f.cols[0]}" if len(f.cols) == 1 else f"{tb.name}.({', '.join(f.cols)})"
        b = f"{f.target}.{f.target_cols[0]}" if len(f.target_cols) == 1 else f"{f.target}.({', '.join(f.target_cols)})"
        act = {"CASCADE": "cascade", "SET NULL": "set null", "RESTRICT": "restrict"}[f.on_delete]
        refs.append(f"Ref: {a} > {b} [delete: {act}]")
    for st in sorted(stubs):
        L += [f"Table {st} {{", "  org_id bigint [not null]" if st not in ("organizations",) else "  id bigint", "  id bigint [not null]", "  Note: 'exists already, see the migrations'", "}", ""]
    L += refs + [""]
    for d, ts in groups.items():
        L.append(f"TableGroup {DOMAINS[d]['code']} {{")
        L += [f"  {t}" for t in ts]
        L += ["}", ""]
    open(os.path.join(dd, "wadesk-port-schema.dbml"), "w").write("\n".join(L))

# ---------------------------------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.getcwd(), "schema-out"))
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args()
    build()
    if ERRORS:
        print("\n".join(ERRORS)); sys.exit(1)
    # tables that collide with names already in the repo
    clash = [t for t in TABLES if t in ALL_EXISTING]
    if clash:
        sys.exit(f"generated tables collide with existing ones: {clash}")
    overlay_codes = {os.path.splitext(f)[0] for f in os.listdir(os.path.join(SRC, "overlays"))} if os.path.isdir(os.path.join(SRC, "overlays")) else set()
    domains_with_tables = [d for d in DEC["domain"] if any(t.domain == d for t in TABLES.values()) or DOMAINS[d]["code"] in overlay_codes]
    if a.report:
        report()
        return
    order_d = domain_order(domains_with_tables)
    pos = {d: i for i, d in enumerate(order_d)}
    global ALL_FKS, ALL_FKS_LIST
    ALL_FKS = {t.name: list(t.fks) for t in TABLES.values()}
    ALL_FKS_LIST = [(t, f) for t in TABLES.values() for f in t.fks]
    # split FKs: inline / deferred (in-domain cycle) / incoming (target domain later)
    incoming = collections.defaultdict(list)
    for tb in TABLES.values():
        keep = []
        for fk in tb.fks:
            if fk.target in TABLES and TABLES[fk.target].domain != tb.domain and pos[TABLES[fk.target].domain] > pos[tb.domain]:
                incoming[TABLES[fk.target].domain].append((tb, fk))
            else:
                keep.append(fk)
        tb.fks = keep
    out = a.out
    os.makedirs(os.path.join(out, "migrations"), exist_ok=True)
    stamp = datetime.datetime.strptime(DEC["meta"]["first_migration_stamp"], "%Y%m%d%H%M%S")
    manifest = []
    for i, d in enumerate(order_d):
        order, deferred = table_order(d)
        for tb in order:
            tb.fks_inline = list(tb.fks)
        ov_path = os.path.join(SRC, "overlays", DOMAINS[d]["code"] + ".sql")
        overlay = open(ov_path).read() if os.path.exists(ov_path) else ""
        sqltxt = migration_sql(d, order, deferred, incoming.get(d, []), overlay)
        ts = (stamp + datetime.timedelta(minutes=i)).strftime("%Y%m%d%H%M%S")
        fname = f"{ts}_{DOMAINS[d]['code']}_wadesk_schema.sql"
        open(os.path.join(out, "migrations", fname), "w").write(sqltxt)
        manifest.append((d, fname, [t.name for t in order]))
        # drizzle
        if not order:
            continue
        body, used, ext = render_domain_ts(d, order, None)
        ddir = os.path.join(out, "schema", d)
        os.makedirs(ddir, exist_ok=True)
        hdr = ["/**", f" * {d}: tables ported from WaDesk. Mirrors migrations/{fname}.", " * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.", " */"]
        pg = sorted(x for x in used if x != "sql")
        imp = ["import {"] + [f"  {x}," for x in pg] + ["} from 'drizzle-orm/pg-core';"]
        if "sql" in used:
            imp.append("import { sql } from 'drizzle-orm';")
        for mod, names in sorted(ext.items()):
            imp.append(f"import {{ {', '.join(sorted(names))} }} from '{mod}';")
        open(os.path.join(ddir, "tables.ts"), "w").write("\n".join(hdr + imp) + "\n\n" + "\n".join(body))
        open(os.path.join(ddir, "index.ts"), "w").write("export * from './tables';\n")
    emit_docs(out, order_d, manifest)
    json.dump({"order": [m[0] for m in manifest], "migrations": {m[0]: m[1] for m in manifest}}, open(os.path.join(out, "manifest.json"), "w"), indent=1)
    report()
    print(f"wrote {len(manifest)} migrations, {len(TABLES)} tables -> {out}")


def report():
    kinds = collections.Counter(KIND.values())
    print("classes:", dict(kinds))
    loose = [(t.name, c, why) for t in TABLES.values() for c, why in t.loose]
    nfk = sum(len(v) for v in ALL_FKS.values()) if "ALL_FKS" in globals() else sum(len(t.fks) for t in TABLES.values())
    print(f"generated tables {len(TABLES)}; fks {nfk}; loose refs {len(loose)}")


if __name__ == "__main__":
    main()
