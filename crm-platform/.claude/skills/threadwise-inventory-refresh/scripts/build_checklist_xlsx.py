#!/usr/bin/env python3
"""Build the Reference port checklist workbook (.xlsx) from the inventory, ownership and assignment files.

  build_checklist_xlsx.py [--out PATH] [--repo-url URL]

Every `### WD-...` feature of every docs/threadwise-port/inventory/*.md becomes one row of the Features tab with all of its
fields, so nothing is retyped by hand. Import the result into Google Sheets (Drive > New > File upload > Open with Sheets,
or Sheets > File > Import). Re-run after the inventory or the assignment changes; do not edit the generated file's
structure, only the status columns.
"""
import argparse, json, os, re, sys
from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
BASE = os.path.join(REPO, "docs", "threadwise-port")
INV = os.path.join(BASE, "inventory")
DEFAULT_OUT = os.path.join(os.path.dirname(REPO), "_work", "out", "Threadwise-Port-Checklist.xlsx")
REPO_URL = "https://github.com/lakshyatyagi241/threadwise/blob/main/crm-platform/docs/threadwise-port/inventory"

FEATURE_RE = re.compile(r"^### (WD-([A-Z0-9]+)-(\d{3})) — (.+)$", re.M)
FIELD_RE = re.compile(r"^- \*\*([^*]+?):\*\*[ \t]*", re.M)
ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
MAXCELL = 32000
FONT = "Arial"

FIELD_MAP = [  # (header, label prefix in the inventory)
    ("Depends on", "depends on"), ("Summary", "summary"), ("Actors & access", "actors"), ("UX & screens", "ux"),
    ("Endpoints", "endpoints"), ("Data", "data"), ("Rules & edge cases", "rules"), ("Async & events", "async"),
    ("External systems", "external"), ("Settings", "settings"), ("Acceptance criteria", "acceptance"),
    ("Source refs", "source"), ("Port notes", "port notes"),
]

# Features that make up today's showcase (auth, roles and permissions, workspace settings, onboarding).
SHOWCASE = {
    "TW-AUTH-001", "TW-AUTH-005", "TW-AUTH-008", "TW-AUTH-011", "TW-AUTH-012", "TW-AUTH-013", "TW-AUTH-014", "TW-AUTH-027",
    "TW-RBAC-001", "TW-RBAC-004", "TW-RBAC-024", "TW-RBAC-026", "TW-RBAC-027",
    "TW-WSP-001", "TW-WSP-002", "TW-WSP-004", "TW-WSP-015", "TW-WSP-016", "TW-WSP-017", "TW-WSP-018", "TW-WSP-038", "TW-WSP-039",
}
SHOWCASE_TITLE = re.compile(r"^Settings (General|Branding)", re.I)  # ASHELL settings hub screens


def clean(s):
    s = ILLEGAL.sub("", s or "").strip()
    return s if len(s) <= MAXCELL else s[:MAXCELL] + "\n[truncated: see the spec file]"


def parse_inventory():
    feats, meta = [], {}
    for f in sorted(os.listdir(INV)):
        if not f.endswith(".md") or f.startswith("_"):
            continue
        t = open(os.path.join(INV, f), encoding="utf-8").read()
        dom = f[:-3]
        title = re.search(r"^title:\s*(.+)$", t, re.M)
        meta[dom] = title.group(1).strip().strip('"') if title else dom
        ms = list(FEATURE_RE.finditer(t))
        for i, m in enumerate(ms):
            end = ms[i + 1].start() if i + 1 < len(ms) else len(t)
            block = t[m.end():end]
            h2 = re.search(r"^## ", block, re.M)
            if h2:
                block = block[:h2.start()]
            parts = list(FIELD_RE.finditer(block))
            fields = {}
            for j, p in enumerate(parts):
                val = block[p.end():(parts[j + 1].start() if j + 1 < len(parts) else len(block))]
                fields[p.group(1).strip().lower()] = val.strip()
            def get(prefix):
                for k, v in fields.items():
                    if k.startswith(prefix):
                        return v
                return ""
            st = re.search(r"(implemented|partial|docs-only|dead-code|beta)", get("status"))
            pr = re.search(r"P[012]", get("priority"))
            ef = re.match(r"\s*(XL|S|M|L)\b", get("effort"))
            row = {"id": m.group(1), "code": m.group(2), "title": m.group(4).strip(), "domain": dom,
                   "status": st.group(1) if st else "unknown", "priority": pr.group(0) if pr else "?",
                   "effort": ef.group(1) if ef else "?"}
            for header, prefix in FIELD_MAP:
                row[header] = get(prefix)
            feats.append(row)
    return feats, meta


def module_titles():
    out = {}
    p = os.path.join(os.path.dirname(REPO), "_work", "workflows", "threadwise-inventory.mjs")
    if os.path.exists(p):
        for m in re.finditer(r"^\['([a-z0-9-]+)','([A-Z0-9]+)','([^']+)'", open(p, encoding="utf-8").read(), re.M):
            out[m.group(1)] = m.group(3)
    return out


def style_header(ws, row=1, fill="1F3864"):
    for c in ws[row]:
        c.font = Font(name=FONT, bold=True, color="FFFFFF", size=10)
        c.fill = PatternFill("solid", start_color=fill)
        c.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[row].height = 30


def widths(ws, spec):
    for col, w in spec.items():
        ws.column_dimensions[col].width = w


def base_font(ws):
    for row in ws.iter_rows():
        for c in row:
            if c.font is None or c.font.name != FONT:
                c.font = Font(name=FONT, size=10, bold=c.font.bold if c.font else False, color=c.font.color if c.font else None)


def status_dv(ws, rng, values):
    dv = DataValidation(type="list", formula1='"' + ",".join(values) + '"', allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv)
    dv.add(rng)


GREEN, AMBER, RED, GREY = "C6EFCE", "FFEB9C", "FFC7CE", "E7E6E6"


def color_status(ws, rng, done=("Done", "Verified"), doing=("In progress",), blocked=("Blocked",)):
    first = rng.split(":")[0]
    for vals, color in ((done, GREEN), (doing, AMBER), (blocked, RED)):
        for v in vals:
            ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=[f'"{v}"'], fill=PatternFill("solid", bgColor=color, start_color=color, end_color=color)))


def build(out, repo_url):
    own = json.load(open(os.path.join(BASE, "ownership.json")))
    inp = json.load(open(os.path.join(BASE, "assignment-input.json")))
    feats, inv_titles = parse_inventory()
    titles = module_titles()
    wb = Workbook()

    # ---------------- Features
    wsF = wb.active
    wsF.title = "Features"
    H = ["Feature ID", "Module", "Code", "Feature", "Priority", "Effort", "Reference status", "Owner", "Cluster", "Wave", "Showcase today",
         "Port status", "Backend", "Frontend", "Tests", "Parity verified", "PR / branch", "Notes"] + [h for h, _ in FIELD_MAP] + ["Spec file"]
    wsF.append(H)
    for f in feats:
        d = own["domains"].get(f["domain"], {})
        owner = d.get("owner", "")
        show = "Yes" if (f["id"] in SHOWCASE or (f["domain"] == "admin-console-shell" and SHOWCASE_TITLE.search(f["title"]))) else ""
        link = f'=HYPERLINK("{repo_url}/{f["domain"]}.md","{f["domain"]}.md")'
        wsF.append([f["id"], f["domain"], f["code"], clean(f["title"]), f["priority"], f["effort"], f["status"],
                    own["owners"].get(owner, {}).get("name", owner), d.get("cluster", ""), d.get("wave", ""), show,
                    "Not started", "Pending", "Pending", "Pending", "Pending", "", ""] + [clean(f[h]) for h, _ in FIELD_MAP] + [link])
    nF = len(feats) + 1
    style_header(wsF)
    wsF.freeze_panes = "E2"
    wsF.auto_filter.ref = f"A1:{get_column_letter(len(H))}{nF}"
    widths(wsF, {"A": 14, "B": 34, "C": 8, "D": 58, "E": 9, "F": 8, "G": 14, "H": 14, "I": 11, "J": 7, "K": 11, "L": 14, "M": 11, "N": 11,
                 "O": 11, "P": 13, "Q": 22, "R": 30, "S": 28, "T": 60, "U": 40, "V": 50, "W": 50, "X": 45, "Y": 60, "Z": 40, "AA": 36,
                 "AB": 36, "AC": 60, "AD": 45, "AE": 45, "AF": 34})
    status_dv(wsF, f"L2:L{nF + 500}", ["Not started", "In progress", "Blocked", "Done", "Verified", "Won't do"])
    for col in "MNOP":
        status_dv(wsF, f"{col}2:{col}{nF + 500}", ["Pending", "In progress", "Done", "N/A"])
    color_status(wsF, f"L2:L{nF + 500}", done=("Done", "Verified"), doing=("In progress",), blocked=("Blocked",))
    for col in "MNOP":
        color_status(wsF, f"{col}2:{col}{nF + 500}", done=("Done",), doing=("In progress",), blocked=())
    for v, color in (("P0", RED), ("P1", AMBER), ("P2", GREY)):
        wsF.conditional_formatting.add(f"E2:E{nF}", CellIsRule(operator="equal", formula=[f'"{v}"'], fill=PatternFill("solid", bgColor=color, start_color=color, end_color=color)))
    wsF.conditional_formatting.add(f"K2:K{nF}", CellIsRule(operator="equal", formula=['"Yes"'], fill=PatternFill("solid", bgColor="BDD7EE", start_color="BDD7EE", end_color="BDD7EE")))
    for v, color in (("dead-code", GREY), ("docs-only", GREY), ("partial", AMBER)):
        wsF.conditional_formatting.add(f"G2:G{nF}", CellIsRule(operator="equal", formula=[f'"{v}"'], fill=PatternFill("solid", bgColor=color, start_color=color, end_color=color)))

    # ---------------- Modules
    wsM = wb.create_sheet("Modules")
    HM = ["Module", "Code", "Title", "Cluster", "Owner", "Wave", "Est. days", "Inventory state", "Features", "P0", "P1", "P2", "Done", "% done", "Spec file", "Notes"]
    wsM.append(HM)
    state_txt = {"written": "written", "partial": "PARTIAL: file incomplete, finish in the next inventory run", "pending": "NOT INVENTORIED YET: no feature rows"}
    for i, (dom, d) in enumerate(own["domains"].items(), start=2):
        title = titles.get(dom) or inv_titles.get(dom) or dom
        link = f'=HYPERLINK("{repo_url}/{dom}.md","{dom}.md")' if d["inventory"] != "pending" else ""
        wsM.append([dom, d["code"], title, d["cluster"], own["owners"][d["owner"]]["name"], d["wave"], d["estDays"], state_txt[d["inventory"]],
                    f"=COUNTIF(Features!$B:$B,$A{i})", f'=COUNTIFS(Features!$B:$B,$A{i},Features!$E:$E,"P0")',
                    f'=COUNTIFS(Features!$B:$B,$A{i},Features!$E:$E,"P1")', f'=COUNTIFS(Features!$B:$B,$A{i},Features!$E:$E,"P2")',
                    f'=COUNTIFS(Features!$B:$B,$A{i},Features!$L:$L,"Done")+COUNTIFS(Features!$B:$B,$A{i},Features!$L:$L,"Verified")',
                    f"=IF(I{i}=0,0,M{i}/I{i})", link, ""])
    nM = len(own["domains"]) + 1
    wsM.append([])
    wsM.append(["Total", None, None, None, None, None, f"=SUM(G2:G{nM})", None, f"=SUM(I2:I{nM})", f"=SUM(J2:J{nM})", f"=SUM(K2:K{nM})", f"=SUM(L2:L{nM})", f"=SUM(M2:M{nM})", f"=IF(I{nM + 2}=0,0,M{nM + 2}/I{nM + 2})"])
    style_header(wsM)
    wsM.freeze_panes = "D2"
    wsM.auto_filter.ref = f"A1:P{nM}"
    widths(wsM, {"A": 44, "B": 8, "C": 62, "D": 11, "E": 14, "F": 7, "G": 10, "H": 44, "I": 10, "J": 6, "K": 6, "L": 6, "M": 8, "N": 9, "O": 36, "P": 30})
    for r in range(2, nM + 3):
        wsM[f"N{r}"].number_format = "0%"
    wsM.cell(row=nM + 2, column=1).font = Font(name=FONT, bold=True, size=10)
    wsM.conditional_formatting.add(f"H2:H{nM}", FormulaRule(formula=[f'LEFT($H2,3)="NOT"'], fill=PatternFill("solid", bgColor=RED, start_color=RED, end_color=RED)))
    wsM.conditional_formatting.add(f"H2:H{nM}", FormulaRule(formula=[f'LEFT($H2,3)="PAR"'], fill=PatternFill("solid", bgColor=AMBER, start_color=AMBER, end_color=AMBER)))

    # ---------------- Foundation
    wsB = wb.create_sheet("Foundation")
    wsB.append(["Id", "Work stream", "Owner", "Est. days", "Wave", "Status", "Notes"])
    for f in inp["foundation"]:
        wsB.append([f["id"], f["title"], own["owners"][f["owner"]]["name"], f["days"], f["wave"], "Not started", ""])
    r0 = len(inp["foundation"]) + 3
    wsB.cell(row=r0, column=1, value="Steward areas (review kernel PRs in these)")
    for k, (area, who) in enumerate(inp["stewards"].items(), start=r0 + 1):
        wsB.cell(row=k, column=1, value=area)
        wsB.cell(row=k, column=3, value=own["owners"][who]["name"])
    style_header(wsB)
    widths(wsB, {"A": 8, "B": 100, "C": 16, "D": 10, "E": 7, "F": 14, "G": 40})
    status_dv(wsB, f"F2:F{len(inp['foundation']) + 1}", ["Not started", "In progress", "Blocked", "Done"])
    color_status(wsB, f"F2:F{len(inp['foundation']) + 1}")

    # ---------------- Today, Decisions, Guide (content defined in the companion JSON)
    plan = json.load(open(os.path.join(BASE, "showcase-plan.json")))
    wsT = wb.create_sheet("Today")
    HT = ["#", "Block", "Area", "Task", "Done when", "TW ids", "Priority", "Est. hours", "Owner", "Status", "Notes"]
    wsT.append(HT)
    for k, t in enumerate(plan["today"], start=1):
        wsT.append([k, t["block"], t["area"], t["task"], t["done_when"], t.get("wd", ""), t["priority"], t["hours"], t.get("owner", "Lakshya Tyagi"), "Not started", ""])
    nT = len(plan["today"]) + 1
    wsT.append([])
    wsT.append([None, None, None, "Must-do hours", None, None, None, f'=SUMIF(G2:G{nT},"Must",H2:H{nT})'])
    wsT.append([None, None, None, "Should-do hours", None, None, None, f'=SUMIF(G2:G{nT},"Should",H2:H{nT})'])
    wsT.append([None, None, None, "Stretch hours", None, None, None, f'=SUMIF(G2:G{nT},"Stretch",H2:H{nT})'])
    style_header(wsT)
    wsT.freeze_panes = "E2"
    widths(wsT, {"A": 5, "B": 24, "C": 12, "D": 70, "E": 70, "F": 28, "G": 10, "H": 10, "I": 16, "J": 14, "K": 34})
    for r in range(2, nT + 1):
        for col in "DE":
            wsT[f"{col}{r}"].alignment = Alignment(wrap_text=True, vertical="top")
    status_dv(wsT, f"J2:J{nT}", ["Not started", "In progress", "Blocked", "Done"])
    color_status(wsT, f"J2:J{nT}")
    for v, color in (("Must", RED), ("Should", AMBER), ("Stretch", GREY)):
        wsT.conditional_formatting.add(f"G2:G{nT}", CellIsRule(operator="equal", formula=[f'"{v}"'], fill=PatternFill("solid", bgColor=color, start_color=color, end_color=color)))

    wsD = wb.create_sheet("Decisions")
    wsD.append(["#", "Decision or action", "Why it matters", "Recommendation", "Owner", "Status", "Notes"])
    for k, d in enumerate(plan["decisions"], start=1):
        wsD.append([k, d["item"], d["why"], d["rec"], d.get("owner", "Lakshya Tyagi"), "Open", ""])
    nD = len(plan["decisions"]) + 1
    style_header(wsD)
    widths(wsD, {"A": 5, "B": 60, "C": 60, "D": 60, "E": 16, "F": 12, "G": 30})
    for r in range(2, nD + 1):
        for col in "BCD":
            wsD[f"{col}{r}"].alignment = Alignment(wrap_text=True, vertical="top")
    status_dv(wsD, f"F2:F{nD}", ["Open", "In progress", "Decided", "Done"])
    for v, color in (("Decided", GREEN), ("Done", GREEN), ("In progress", AMBER)):
        wsD.conditional_formatting.add(f"F2:F{nD}", CellIsRule(operator="equal", formula=[f'"{v}"'], fill=PatternFill("solid", bgColor=color, start_color=color, end_color=color)))

    wsG = wb.create_sheet("Guide", 0)
    rows = [
        ["Reference port: checklist"],
        ["One row per feature of the Reference inventory, grouped by module. Status columns are the only cells meant to be edited."],
        [],
        ["Totals (live formulas)", "Value"],
        ["Modules planned", "=COUNTA(Modules!A2:A63)"],
        ["Modules with features written", '=COUNTIF(Modules!H2:H63,"written")'],
        ["Modules partly written", '=COUNTIF(Modules!H2:H63,"PARTIAL*")'],
        ["Modules not inventoried yet", '=COUNTIF(Modules!H2:H63,"NOT*")'],
        ["Features listed", "=COUNTA(Features!A:A)-1"],
        ["Priority P0", '=COUNTIF(Features!E:E,"P0")'],
        ["Priority P1", '=COUNTIF(Features!E:E,"P1")'],
        ["Priority P2", '=COUNTIF(Features!E:E,"P2")'],
        ["In today's showcase", '=COUNTIF(Features!K:K,"Yes")'],
        ["Done or verified", '=COUNTIF(Features!L:L,"Done")+COUNTIF(Features!L:L,"Verified")'],
        ["% of features done", '=IF(B9=0,0,B14/B9)'],
        [],
        ["Tabs"],
        ["Today", "The time-boxed plan for the first showcase: base setup, auth, roles and permissions, workspace settings, onboarding."],
        ["Modules", "All 62 planned modules with owner, wave, estimate, inventory state and live rollups from the Features tab."],
        ["Features", "Every feature with priority, effort, owner, wave and the full spec fields (summary, actors, UX, endpoints, data, rules, acceptance criteria, source refs). Filter by Module, Owner or Showcase today."],
        ["Foundation", "Work that must exist before or alongside module work (skeleton PR, web foundation, operator layer, channel core, worker plumbing, storage and mail, test harness)."],
        ["Decisions", "Open decisions and actions that only the team lead can close."],
        [],
        ["Columns to maintain on the Features tab"],
        ["Port status", "Not started, In progress, Blocked, Done (merged with tests), Verified (compared against the running Reference), Won't do (say why in Notes)."],
        ["Backend, Frontend, Tests, Parity verified", "Pending, In progress, Done or N/A, so a feature can be half done and still tracked."],
        ["Reference status", "implemented, partial, docs-only (advertised but absent in the code), dead-code. Treat docs-only and dead-code as Won't do unless the team decides otherwise."],
        ["Priority", "P0 the product is unusable without it, P1 customers expect it, P2 nice to have."],
        ["Effort", "S up to 2 dev-days, M up to a week, L up to two weeks, XL longer, for backend, frontend and tests together."],
        [],
        ["Known gaps"],
        ["Not inventoried yet", "29 modules (listed on the Modules tab) have no feature rows until the next inventory run. Seven more modules are partly written."],
        ["Source", "Generated from crm-platform/docs/threadwise-port/inventory in the threadwise-port repository. Regenerate with build_checklist_xlsx.py after the inventory or the assignment changes."],
    ]
    for r in rows:
        wsG.append(r)
    wsG["A1"].font = Font(name=FONT, bold=True, size=16)
    for r in (4, 17, 23, 31):
        for c in wsG[r]:
            c.font = Font(name=FONT, bold=True, size=10, color="FFFFFF")
            c.fill = PatternFill("solid", start_color="1F3864")
    wsG["B15"].number_format = "0%"
    widths(wsG, {"A": 46, "B": 120})
    for r in range(1, len(rows) + 1):
        wsG[f"B{r}"].alignment = Alignment(wrap_text=True, vertical="top")

    for ws in (wsG, wsT, wsM, wsF, wsB, wsD):
        for row in ws.iter_rows():
            for c in row:
                if c.font.name != FONT:
                    c.font = Font(name=FONT, size=c.font.size or 10, bold=c.font.bold, color=c.font.color)
    wb._sheets = [wsG, wsT, wsM, wsF, wsB, wsD]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    wb.save(out)
    return feats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--repo-url", default=REPO_URL)
    a = ap.parse_args()
    feats = build(a.out, a.repo_url)
    ids = [f["id"] for f in feats]
    assert len(ids) == len(set(ids)), "duplicate feature ids"
    print(f"wrote {a.out}: {len(feats)} features")


if __name__ == "__main__":
    main()
