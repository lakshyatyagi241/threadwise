#!/usr/bin/env python3
"""Extract schema facts from WaDesk Eloquent models: table, casts, belongsTo/hasMany/etc.
Facts only (names), no code copied. Output: model-facts.json"""
import re, json, glob, os, sys
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "..", "wadesk-reference", "WaDesk")
SRC = os.environ.get("SCHEMA_SRC") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "docs", "wadesk-port", "schema", "source")
SCHEMA = json.load(open(os.path.join(SRC, "wadesk-schema.json")))
TABLES = set(SCHEMA)

def snake(s): return re.sub(r'(?<!^)(?=[A-Z])', '_', s).lower()
def plural(w):
    if w.endswith('y') and w[-2] not in 'aeiou': return w[:-1] + 'ies'
    if w.endswith(('s', 'x', 'ch', 'sh')): return w + 'es'
    return w + 's'
def guess_table(cls):
    base = snake(cls)
    parts = base.split('_'); cand = '_'.join(parts[:-1] + [plural(parts[-1])])
    for c in (cand, base, base + 's'):
        if c in TABLES: return c
    return cand

models = {}
for f in sorted(glob.glob(os.path.join(ROOT, 'app/Models/**/*.php'), recursive=True)):
    s = open(f, encoding='utf-8', errors='replace').read()
    m = re.search(r'\bclass\s+(\w+)\s+extends', s)
    if not m: continue
    cls = m.group(1)
    t = re.search(r"\$table\s*=\s*['\"](\w+)['\"]", s)
    table = t.group(1) if t else guess_table(cls)
    casts = {}
    cm = re.search(r'\$casts\s*=\s*\[(.*?)\];', s, re.S) or re.search(r'function\s+casts\s*\(\)[^{]*\{\s*return\s*\[(.*?)\];', s, re.S)
    if cm:
        for k, v in re.findall(r"['\"](\w+)['\"]\s*=>\s*['\"]([^'\"]+)['\"]", cm.group(1)):
            casts[k] = v
    rels = []
    for mm in re.finditer(r'function\s+(\w+)\s*\([^)]*\)[^{]*\{\s*return\s+\$this->(belongsTo|hasMany|hasOne|belongsToMany|morphTo|morphMany|hasManyThrough)\(', s, re.S):
        i, depth = mm.end(), 1
        while i < len(s) and depth:
            depth += {'(': 1, ')': -1}.get(s[i], 0); i += 1
        args = s[mm.end():i - 1]  # only the relation call's own arguments, not chained ->where(...) calls
        rc = re.search(r'(\w+)::class', args)
        keys = re.findall(r"['\"](\w+)['\"]", args)
        rels.append({'method': mm.group(1), 'kind': mm.group(2), 'class': rc.group(1) if rc else None, 'keys': keys})
    models[cls] = {'file': os.path.relpath(f, ROOT), 'table': table, 'casts': casts, 'relations': rels,
                   'soft_deletes': 'SoftDeletes' in s}
cls2table = {c: m['table'] for c, m in models.items()}
for c, m in models.items():
    for r in m['relations']:
        r['target_table'] = cls2table.get(r['class']) if r['class'] else None
json.dump(models, open(os.path.join(SRC, 'model-facts.json'), 'w'), separators=(',', ':'))
bt = sum(1 for m in models.values() for r in m['relations'] if r['kind'] == 'belongsTo')
print(len(models), 'models;', bt, 'belongsTo;', sum(len(m['casts']) for m in models.values()), 'casts;',
      len({m['table'] for m in models.values()} & TABLES), 'tables covered')
print('models whose table not in DB:', [(c, m['table']) for c, m in models.items() if m['table'] not in TABLES][:15])
