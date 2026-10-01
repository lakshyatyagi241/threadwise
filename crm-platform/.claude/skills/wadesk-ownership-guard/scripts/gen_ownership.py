#!/usr/bin/env python3
"""Generate docs/wadesk-port/ownership.json and assignments.md from assignment-input.json.

  gen_ownership.py            regenerate both files
  gen_ownership.py --check    exit 1 if the checked-in files differ from what would be generated

Edit assignment-input.json (change a cluster's or a domain's owner, wave, days), never the generated files.
Zone globs follow docs/wadesk-port/conflict-map.md section 3.2. After changing owners run
`tracker.py init --all` and `tracker.py validate` (wadesk-parity-tracker).
"""
import collections, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
BASE = os.path.join(REPO, "docs", "wadesk-port")
INV = os.path.join(BASE, "inventory")
FEATURE_RE = re.compile(r"^### WD-[A-Z0-9]+-\d{3} — ", re.M)
CODE_RE = re.compile(r"^[a-z][a-z0-9]{1,11}$")

ZONE_TEMPLATE = [
    "apps/api/src/modules/{domain}/",
    "apps/api/src/infra/providers/{domain}/",
    "apps/api/src/config/domains/{domain}.env.ts",
    "apps/api/test/unit/{domain}/",
    "apps/api/test/integration/{domain}/",
    "apps/api/test/e2e/{domain}/",
    "packages/contracts/src/{domain}/",
    "packages/db/src/schema/{domain}/",
    "packages/db/src/seeds/{domain}.ts",
    "packages/db/migrations/??????????????_{code}_*.sql",
    "apps/web/src/app/(app)/({domain})/",
    "apps/web/src/app/(admin)/({domain})/",
    "apps/web/src/features/{domain}/",
    "apps/web/messages/*/{domain}.json",
    "apps/web/e2e/{domain}/",
    "docs/api/{domain}.md",
]

# Existing code that belongs to a domain because it is that domain's predecessor (conflict-map 3.3, legacy areas).
LEGACY = {
    "contacts-attributes-tags": [
        "apps/api/src/modules/crm/", "packages/contracts/src/crm/",
        "packages/db/src/schema/crm.ts", "packages/db/src/schema/contact-detail.ts",
        "packages/db/src/schema/contact-views.ts", "packages/db/src/schema/field-metadata.ts",
    ],
    "roles-permissions": ["apps/api/src/modules/admin/", "packages/contracts/src/admin/"],
    # Sign-in/sign-up, the lock screens, the operator console and their message files (split by audience).
    "auth-registration-security": [
        "apps/api/src/modules/auth/", "apps/web/messages/*/auth-registration-security.*.json",
        "apps/web/src/app/(gate)/", "apps/web/src/app/(operator-auth)/",
    ],
    "developer-rest-api-v1": [
        "apps/api/src/modules/partner/", "apps/api/src/modules/public-api/",
        "packages/contracts/src/partner/", "packages/contracts/src/public/", "packages/db/src/schema/partner.ts",
    ],
    # The app shell is one domain's code, not a route group: it is where the K4 steward works.
    "admin-console-shell": [
        "apps/web/src/components/shell/", "apps/web/src/app/layout.tsx", "apps/web/src/app/providers.tsx",
        "apps/web/src/app/(app)/layout.tsx", "apps/web/src/app/(admin)/layout.tsx",
        "apps/web/src/app/globals.css", "apps/web/src/app/page.tsx", "apps/web/src/lib/", "apps/web/src/i18n/", "apps/web/scripts/",
        "apps/web/src/features/_registry/", "apps/web/src/app/api/",
        "apps/web/src/app/(auth)/", "apps/web/next.config.ts", "packages/ui/",
    ],
}

KERNEL = [
    "apps/api/src/app.module.ts", "apps/api/src/main.ts", "apps/api/src/worker.ts", "apps/api/src/domains.generated.ts",
    "apps/api/src/kernel/", "apps/api/src/common/", "apps/api/src/realtime/", "apps/api/src/health/",
    "apps/api/src/workers/", "apps/api/src/tools/",
    ".env.example", ".gitignore", "apps/api/src/config/env.schema.ts", "apps/api/src/config/config.module.ts", "apps/api/src/config/zod-helpers.ts",
    "apps/api/src/infra/db/", "apps/api/src/infra/redis/", "apps/api/src/infra/queue/",
    "apps/api/src/infra/providers/providers.module.ts", "apps/api/src/infra/providers/whatsapp/",
    "apps/api/src/infra/providers/payments/", "apps/api/test/support/",
    "packages/db/src/client.ts", "packages/db/src/tenant.ts", "packages/db/src/migrator.ts", "packages/db/src/index.ts",
    "packages/db/src/cli/", "packages/db/src/schema/columns.ts", "packages/db/src/schema/enums.ts",
    "packages/db/src/schema/foundation.ts", "packages/db/src/schema/ops.ts", "packages/db/src/schema/index.ts",
    "packages/db/migrations/00*.sql",
    "packages/contracts/package.json", "packages/contracts/src/index.ts", "packages/contracts/src/common/",
    "packages/config/", ".github/", "docker/", "docker-compose*.yml", "turbo.json", "package.json",
    "pnpm-workspace.yaml", ".npmrc", "eslint.config.mjs", "commitlint.config.cjs", ".husky/", ".claude/skills/",
    "CLAUDE.md", "CONTRIBUTING.md", "docs/architecture/", "docs/runbooks/", "docs/db/",
    "docs/README.md", "docs/skill-router.md", "tools/",
    "apps/web/package.json", "apps/web/tsconfig.json", "apps/web/postcss.config.mjs", "apps/web/vitest.config.ts",
    "apps/web/Dockerfile", "apps/api/Dockerfile",
]

SEAMS = [
    {"path": "pnpm-lock.yaml", "policy": "never hand-merge; on conflict take main's copy and run pnpm install", "reviewer": "punya"},
    {"path": "apps/*/package.json", "policy": "dependency additions only, in their own 'chore(deps)' PR merged within the hour", "reviewer": "punya"},
    {"path": "packages/*/package.json", "policy": "dependency additions only, in their own 'chore(deps)' PR merged within the hour", "reviewer": "punya"},
    {"path": "docs/wadesk-port/ownership.json", "policy": "generated from assignment-input.json; changes need all three developers' approval", "reviewer": "lakshya"},
    {"path": "docs/wadesk-port/assignment-input.json", "policy": "the single place to change owners, waves and estimates; needs all three developers' approval", "reviewer": "lakshya"},
    {"path": "docs/wadesk-port/assignments.md", "policy": "generated; do not hand-edit", "reviewer": "lakshya"},
]


def zone_for(dom):
    z = [g.format(domain=dom["id"], code=dom["code"]) for g in ZONE_TEMPLATE] + LEGACY.get(dom["id"], [])
    return z


def feature_counts():
    out = {}
    if os.path.isdir(INV):
        for f in os.listdir(INV):
            if f.endswith(".md") and not f.startswith("_"):
                out[f[:-3]] = len(FEATURE_RE.findall(open(os.path.join(INV, f), encoding="utf-8").read()))
    return out


def build():
    src = json.load(open(os.path.join(BASE, "assignment-input.json")))
    owners, clusters = src["owners"], src["clusters"]
    codes, bases, doms = set(), set(), {}
    for d in src["domains"]:
        assert CODE_RE.match(d["code"]) and d["code"] != "core", f"bad code {d['code']}"
        assert d["code"] not in codes, f"duplicate code {d['code']}"
        assert d["routeBase"] not in bases, f"duplicate routeBase {d['routeBase']}"
        assert d["cluster"] in clusters, f"unknown cluster {d['cluster']}"
        codes.add(d["code"]); bases.add(d["routeBase"])
        owner = d.get("owner") or clusters[d["cluster"]]["owner"]
        assert owner in owners, f"unknown owner {owner}"
        doms[d["id"]] = {"code": d["code"], "owner": owner, "cluster": d["cluster"], "wave": d["wave"],
                         "estDays": d["days"], "inventory": d["inventory"], "routeBase": d["routeBase"], "zone": zone_for(d)}
    own = {
        "version": 1, "generatedFrom": "assignment-input.json (edit that, then run gen_ownership.py)",
        "owners": owners, "clusters": clusters, "stewards": src["stewards"], "foundation": src["foundation"],
        "domains": doms, "zoneTemplate": ZONE_TEMPLATE, "kernel": KERNEL, "seams": SEAMS,
    }
    return own


def render_md(own):
    fc = feature_counts()
    doms, owners, clusters = own["domains"], own["owners"], own["clusters"]
    L = ["# Assignments", "",
         "Generated by `.claude/skills/wadesk-ownership-guard/scripts/gen_ownership.py` from `assignment-input.json`. Do not hand-edit; change the input and regenerate.", "",
         "**How features are assigned.** Every feature belongs to its domain, and every domain has exactly one owner, so each `WD-<CODE>-<NNN>` in the",
         "inventory has one owner (see `tracker/<owner>.md`, or `find_feature.py WD-...`). Domains that read and write the same tables are grouped under one person,",
         "and each domain has exclusive directories in every layer, so the three of you do not edit the same files.", "",
         "**Estimates.** `estDays` uses S=1.5, M=4, L=8, XL=15 dev-days from the inventory for domains already written, and a rough analogue-based guess for the rest",
         "(marked `pending` or `partial`). Treat them as order-of-magnitude until the inventory is complete and the scope cut (P0 or P0+P1) is decided.", ""]
    per = collections.defaultdict(lambda: {"days": 0.0, "feat": 0, "dom": 0, "fnd": 0.0})
    for i, d in doms.items():
        p = per[d["owner"]]; p["days"] += d["estDays"]; p["feat"] += fc.get(i, 0); p["dom"] += 1
    for f in own["foundation"]:
        per[f["owner"]]["fnd"] += f["days"]
    L += ["## Summary", "", "| Person | Cluster | Domains | Features written | Domain est. days | Foundation days | Total |", "|---|---|---|---|---|---|---|"]
    for o, info in owners.items():
        cl = ", ".join(c["title"] for c in clusters.values() if c["owner"] == o) or "-"
        p = per[o]
        L.append(f"| {info['name']} (`{o}`) | {cl} | {p['dom']} | {p['feat']} | {p['days']:.0f} | {p['fnd']:.0f} | {p['days'] + p['fnd']:.0f} |")
    L += ["", "The people are interchangeable: to swap two clusters, change `owner` in `assignment-input.json` `clusters` and regenerate.", "", "## Why these groups", ""]
    for k, c in clusters.items():
        L += [f"- **{c['title']}** (`{c['owner']}`): {c['why']}"]
    L += ["", "## Foundation work streams (before or alongside domain work)", "", "| Id | Work | Owner | Days | Wave |", "|---|---|---|---|---|"]
    for f in own["foundation"]:
        L.append(f"| {f['id']} | {f['title']} | `{f['owner']}` | {f['days']} | {f['wave']} |")
    L += ["", "Stewards of the shared kernel (reviewer for kernel PRs, see conflict-map section 4): " + "; ".join(f"{k}: `{v}`" for k, v in own["stewards"].items()) + ".", "",
          "## Waves", "", "0 = foundation. 1 = identity, tenancy, channel core, contacts. 2 = billing, inbox, broadcasts, the sales objects. 3 = automation, the rest of the channels, commerce, developer surface. 4 = AI and calling.",
          "A domain in wave N can start earlier against stubs, but it cannot be marked `done` before its dependencies in earlier waves are.", ""]
    for o, info in owners.items():
        L += [f"## {info['name']} (`{o}`)", "", "| Domain | Code | Route | Wave | Est. days | Inventory | Features |", "|---|---|---|---|---|---|---|"]
        for i, d in sorted(((i, d) for i, d in doms.items() if d["owner"] == o), key=lambda x: (x[1]["wave"], x[0])):
            L.append(f"| {i} | {d['code']} | /{d['routeBase']} | {d['wave']} | {d['estDays']:.0f} | {d['inventory']} | {fc.get(i, '') or ''} |")
        L.append("")
    L += ["## Handoffs between people", "",
          "These are the places where one person consumes another's work. Build against the interface and stub until it lands; mark the tracker row `blocked` with the id you wait for.", "",
          "| Consumer | Needs | From |", "|---|---|---|",
          "| messaging (every domain) | contacts and identity resolution (`con`) | crm (`punya`) |",
          "| messaging: broadcasts, campaigns, calling | wallet charge and plan gating (`wallet`, `plan`, F2) | platform (`lakshya`) |",
          "| crm: nine other channels | channel core and the WhatsApp reference adapter (F3, `wadev`, `waba`) | messaging (`vedant`) |",
          "| crm: AI agents | inbox message stream and token metering (`tib1`, `aiadm`) | messaging (`vedant`), platform (`lakshya`) |",
          "| all | web shell, `@crm/ui`, session, API client (F1) | platform (`lakshya`) |",
          "| all | queue registry, outbox subscribers, realtime bridge (F4) | messaging (`vedant`) |",
          "| all | test harness and CI (F6), storage and mail (F5) | crm (`punya`) |", ""]
    return "\n".join(L) + "\n"


def main():
    own = build()
    md = render_md(own)
    op, mp = os.path.join(BASE, "ownership.json"), os.path.join(BASE, "assignments.md")
    js = json.dumps(own, indent=1) + "\n"
    if "--check" in sys.argv:
        ok = os.path.exists(op) and open(op).read() == js and os.path.exists(mp) and open(mp).read() == md
        print("up to date" if ok else "ownership.json / assignments.md are stale: run gen_ownership.py")
        sys.exit(0 if ok else 1)
    open(op, "w").write(js); open(mp, "w").write(md)
    print(f"wrote ownership.json ({len(own['domains'])} domains) and assignments.md")


if __name__ == "__main__":
    main()
