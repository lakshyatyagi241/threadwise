# Help center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the plan-aware in-app Help center (docs gated like the menu, a Help icon above Settings, "?" tooltips linking to docs) and the mechanism that makes every built or pulled feature get a doc automatically.

**Architecture:** Docs are markdown files in `features/<domain>/help/`. `gen-registry.mjs` compiles them (a pure compiler in `apps/web/scripts/help-compile.mjs`) into a gitignored `help.generated.ts`. Pure functions resolve which docs a person may see from the already-resolved nav and Settings tiles plus plan capabilities; server components render `/help` and `/help/[id]`; a client context carries a small index for tooltips. A vitest coverage gate, a post-merge hook, a SessionStart hook and a `help-docs-sync` skill keep docs complete.

**Tech Stack:** Next.js 16 (App Router, server components and actions), React 19, next-intl, vitest 2 (node environment, components rendered with `react-dom/server`), Playwright, Node 22 `.mjs` scripts. No new dependency.

**Spec:** [docs/specs/help-center.md](help-center.md)

## Global Constraints

- Nothing is committed or pushed unless the owner asks (repo `CLAUDE.md`). Steps below end with a checkpoint (run the checks), never `git commit`. The working tree already holds other people's uncommitted changes (marketplace, admin console); touch only the files named here and never revert or reformat others.
- No new dependency and no edit to any `package.json` (seam: dependency additions only). No database table, migration, endpoint or permission.
- Markdown subset (verbatim from spec 4.1): `##`/`###` headings, paragraphs, `-` and `1.` lists, `> ` callouts, `**bold**`, `` `code` ``, links that are app-relative paths or `help:<doc-id>`. No raw HTML, no external URLs, no images, no tables, no code fences, no `#` or `####` headings.
- Summary is at most 160 characters. Doc ids are kebab-case and unique across the app.
- A missing plan feature **removes** a doc (never a lock). Unknown capabilities (`null`) remove nothing. A doc is visible when at least one documented screen is available, or it documents none.
- `/help/<id>` for a doc the person cannot see returns 404; hidden doc text never reaches the browser.
- Web code style: logical properties (`ms-`, `ps-`, `start-`, `end-`) for RTL; focus rings as in `top-bar.tsx`; messages in `messages/{en,ar}/help-center.json` under the top-level key `help`; `en` and `ar` have exactly the same keys.
- Docs are written in our own words about our screens; no Reference text pasted (the port skill forbids copying its copy-deck).
- Run vitest as `cd apps/web && node node_modules/vitest/vitest.mjs run <path>` (vitest is not on PATH for `pnpm exec` on this machine). Typecheck and lint: `pnpm --filter @crm/web typecheck`, `pnpm --filter @crm/web lint`.

## Review Focus

Inputs the spec implies but its main tests do not exercise; each is pinned by a test in the owning task.

1. **CRLF files.** This repo is edited on Windows; every `.md` may arrive with `\r\n`. Frontmatter and body must parse identically (Task 1).
2. **Frontmatter values containing `:`, `#` or quotes** (a summary like `Contacts: add, import and group people`). Must round-trip, not be cut at the colon or treated as a comment (Task 1).
3. **Headings that slug to nothing or collide** (Arabic-only, punctuation-only, two identical headings). Ids must be non-empty and unique within a doc (Task 1).
4. **Route matching edge cases:** trailing slash, query string, `/` (Dashboard) only matching exactly, and no page tip on `/help` itself (Task 3).
5. **A tip pointing at a doc or heading that is gone** (plan changed, doc deleted, anchor renamed). It renders nothing or falls back to the summary; it never throws or shows an empty bubble (Tasks 3 and 7).

---

## File Structure

```
apps/web/
  scripts/gen-registry.mjs                      MODIFY  third registry (help)
  src/features/help-center/
    (compiler: apps/web/scripts/help-compile.mjs + help-compile.d.mts, see Task 1)
    types.ts                                    CREATE  HelpDoc, HelpBlock, HelpIndexEntry, HELP_AREAS
    blocks.ts                                   CREATE  block helpers: plainText, leadParagraph, degradeDocLinks
    resolve.ts                                  CREATE  resolveHelp, localized, toIndex, visibleHelp
    search.ts                                   CREATE  matchHelp, docForPath
    context.tsx                                 CREATE  HelpProvider, useHelpEntries, useHelpEntry (client)
    server.ts                                   CREATE  getVisibleHelp (server-only)
    actions.ts                                  CREATE  getHelpTip (server action)
    doc-body.tsx                                CREATE  renders blocks (server-safe)
    help-home.tsx, help-search.tsx              CREATE  /help list (search is the client island)
    hash-focus.tsx                              CREATE  moves focus to the #heading (client)
    help-tip.tsx                                CREATE  HelpTip, PageHelpTip, tipHref (client)
    nav.ts                                      CREATE  the Help menu entry
    coverage.ts                                 CREATE  pure coverage rules
    pending.json                                CREATE  reviewed list of undocumented units
    index.ts                                    CREATE  client-safe public surface
    help/getting-started.md, help/using-help.md CREATE  the two guide docs of this domain
    *.test.ts(x)                                CREATE  next to each unit
  src/app/(app)/(help-center)/help/page.tsx, [id]/page.tsx   CREATE
  src/app/(app)/layout.tsx                      MODIFY  resolve visible docs, wrap in HelpProvider
  src/components/shell/top-bar.tsx, app-shell.tsx, nav-rail.tsx   MODIFY  pageHelp slot; neutral aria-label
  messages/en/help-center.json, messages/ar/help-center.json      CREATE
  messages/{en,ar}/shell.json                   MODIFY  shell.pinned
  e2e/help-center/help.spec.ts                  CREATE
src/features/<domain>/help/*.md                 CREATE  first content pass (new files only)
.claude/skills/help-docs-sync/                  CREATE  SKILL.md + scripts/{pending.sh,session_start.sh}
.claude/settings.json, .claude/skills/README.md, .claude/skills/threadwise-port-feature/SKILL.md   MODIFY
.claude/skills/threadwise-ownership-guard/scripts/gen_ownership.py, docs/threadwise-port/ownership.json   MODIFY  seams
.husky/post-merge                               CREATE
.gitignore                                      MODIFY  3 generated paths (kernel file, additive)
CLAUDE.md                                       MODIFY  the standing rule
docs/threadwise-port/parity/help-center.md          CREATE  intended differences
```

---

### Task 1: Markdown and frontmatter compiler

**Files:**

- Create: `apps/web/scripts/help-compile.mjs`, `apps/web/scripts/help-compile.d.mts`, `apps/web/src/features/help-center/types.ts`
- Test: `apps/web/src/features/help-center/compile.test.ts`

**Interfaces:**

- Produces (`types.ts`): `HELP_AREAS` = `['overview','inbox','audience','sales','campaigns','automation','store','apps','settings','account','getting-started']`; `type HelpArea`; `HelpInline` = `{t:'text'|'bold'|'code'; v:string} | {t:'link'; v:string; href:string} | {t:'doc'; v:string; doc:string}`; `HelpBlock` = `{t:'h'; level:2|3; id:string; text:string} | {t:'p'; inline:HelpInline[]} | {t:'ul'|'ol'; items:HelpInline[][]} | {t:'note'; inline:HelpInline[]}`; `HelpLocaleText = {title:string; summary:string; blocks:HelpBlock[]}`; `HelpDoc = {id; area:HelpArea; order:number; documents:string[]; gates:NavGates; keywords:string[]; routes:string[]; audience:'workspace'|'operator'; domain:string; text:Record<string,HelpLocaleText>}` (`text.en` always present); `HelpIndexEntry = {id; area; order; title; summary; keywords:string[]; routes:string[]; headings:{id:string;text:string;level:2|3}[]; fallback:boolean}`.
- Produces (`scripts/help-compile.mjs`, typed in `scripts/help-compile.d.mts`): `compileRegistry(files: {domain:string; file:string; source:string}[]): HelpDoc[]` (file name is `<slug>.md` or `<slug>.<locale>.md`; throws `Error` whose message starts with `<domain>/help/<file>:`); `renderGenerated(docs: HelpDoc[]): string`; `slugify(text: string): string`.

- [ ] **Step 1: Write the failing tests** in `compile.test.ts` (use a `src(over)` helper that builds a valid file and a `reg(...)` that calls `compileRegistry([{domain:'d', file:'a.md', source}])`). Test names and assertions:
  - `parses frontmatter and blocks` — `id: contacts-overview`, `title`, `summary`, `area: audience`, `order: 10`, `documents: [nav:contacts, tile:contact-properties]`, `gates:` block with `planFeature: sales_pipeline`, `keywords: [people, leads]`; expect `doc.documents` equal both, `doc.gates` equal `{planFeature:'sales_pipeline'}`, `doc.text.en.blocks[0]` equal `{t:'h',level:2,id:'getting-started',text:'Getting started'}`, `domain` is `'d'`, defaults `order=100`, `audience='workspace'`, `routes=[]`.
  - `handles CRLF files` — same source with every `\n` replaced by `\r\n` compiles to an identical doc (Review Focus 1).
  - `keeps colons, hashes and quotes inside values` — `summary: Contacts: add, import and group people #1 "fast"` yields exactly that string; a line starting with `#` before the closing `---` is a comment and ignored (Review Focus 2).
  - `blocks`: `- a`/`1. b` lists, `> note` callout, `**bold**`, `` `code` ``, `[x](/contacts)` link, `[y](help:other)` doc link produce the exact `HelpBlock`/`HelpInline` shapes.
  - `slugs headings` — `## A & B` → `a-b`; two `## Setup` → `setup`, `setup-2`; `## الإعداد` and `## ???` get non-empty ids `section-1`, `section-2` by position (Review Focus 3).
  - `rejects` (each `toThrow(/d\/help\/a\.md: .*<fragment>/)`): missing `id`; bad id `Bad_ID`; summary 161 chars; unknown `area`; `# H1`; `#### H4`; a line starting with `<div`; `[x](https://a.com)`; `[x](//a.com)`; `![img](/a.png)`; a line starting with `|`; a line starting with three backticks; `[x](help:nope)` when no doc `nope`; duplicate ids across two files; `planFeature` given as a list.
  - `merges translations` — `a.ar.md` with the same `id`, its own `title`, `summary`, body → `doc.text.ar` set, `doc.text.en` unchanged, `area`/`documents`/`gates` taken from English only; an `a.ar.md` without `a.md` throws `/needs an English/`; an `a.ar.md` whose `id` differs throws `/id must match/`.
  - `renderGenerated` — output starts with `// GENERATED by scripts/gen-registry.mjs. Do not edit; do not commit.`, contains `import type { HelpDoc } from '../help-center/types';` and `export const HELP_DOCS: HelpDoc[] = ` and is valid JSON after that prefix (strip the export line and `JSON.parse`).
- [ ] **Step 2: Run to verify failure.** `cd apps/web && node node_modules/vitest/vitest.mjs run src/features/help-center/compile.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `scripts/help-compile.mjs`.** Normalise `\r\n` first. Frontmatter is the text between the first two `---` lines; parse a subset by hand (no YAML library): `key: value` scalars (split at the first `: `; a value is everything after, trimmed, with one pair of surrounding quotes removed), `[a, b]` flow lists, and one nested map (`gates:` followed by indented `key: value` lines); lines starting `#` are comments, inline `#` is literal. Body: line-oriented block parser, then an inline tokenizer for `**`, `` ` `` and `[text](target)`. Validate everything in the Global Constraints; error text names the file and the rule. `.d.mts` declares the three exports with the `types.ts` types.
- [ ] **Step 4: Run to verify pass.** Same command → all PASS.
- [ ] **Step 5: Checkpoint.** `pnpm --filter @crm/web lint` and `pnpm --filter @crm/web typecheck` clean for these files.

---

### Task 2: Third registry in the generator

**Files:**

- Modify: `apps/web/scripts/gen-registry.mjs`, `.gitignore` (3 lines after line 36: `apps/web/src/features/_registry/help.generated.ts`, `apps/web/src/features/_registry/help-index.generated.ts`, `docs/help-pending.md`)
- Test: `apps/web/src/features/help-center/generated.test.ts`

**Interfaces:**

- Consumes: `compileRegistry`, `renderGenerated` (Task 1).
- Produces: `features/_registry/help.generated.ts` exporting `HELP_DOCS: HelpDoc[]` (empty array when no doc files exist). `help-index.generated.ts` is not produced (spec 4.2's second file is replaced by the per-request `toIndex`, Task 3, because the index depends on the person's locale and visible docs).

- [ ] **Step 1: Write the failing test** `generated.test.ts`: imports `HELP_DOCS` from `@/features/_registry/help.generated`; asserts it is an array, every doc has `text.en.title`, ids are unique, and `getting-started` exists (that doc is created in Task 5; until then this last assertion is added in Task 5, so here assert only the first three).
- [ ] **Step 2: Run** → FAIL (generated file missing).
- [ ] **Step 3: Implement** in `gen-registry.mjs`: after the two `build(...)` calls, read every `features/*/help/*.md` (skip `_`-prefixed domains), call `compileRegistry`, write `_registry/help.generated.ts` with `renderGenerated`. On a compile error print the message and `process.exit(1)` so `dev`, `build`, `lint`, `typecheck` and `test` all stop. Log `help registry: N doc(s)`.
- [ ] **Step 4: Run** `node apps/web/scripts/gen-registry.mjs` (prints `help registry: 0 doc(s)`) then the test → PASS.
- [ ] **Step 5: Checkpoint.** `git status --short` shows the two generated paths ignored.

---

### Task 3: Pure resolution, search and block helpers

**Files:**

- Create: `apps/web/src/features/help-center/{blocks,resolve,search}.ts`
- Test: `blocks.test.ts`, `resolve.test.ts`, `search.test.ts` beside them

**Interfaces:**

- Consumes: `HelpDoc`, `HelpBlock`, `HelpIndexEntry`, `HELP_AREAS` (Task 1); `evaluateGates`, `Capabilities` from `@/features/_registry/resolve` and `types`; `ResolvedNavItem`; `ResolvedSettingsTile`.
- Produces:
  - `blocks.ts`: `plainText(inline: HelpInline[]): string`; `leadParagraph(blocks: HelpBlock[], anchor?: string): string | null` (first `p` after heading `anchor`, or first `p` of the doc when no anchor; stops at the next heading of equal or higher level; trimmed to 240 chars with `…`); `degradeDocLinks(blocks: HelpBlock[], visibleIds: ReadonlySet<string>): HelpBlock[]` (a `doc` inline whose target is not visible becomes `{t:'text'}`).
  - `resolve.ts`: `resolveHelp(docs, nav: readonly ResolvedNavItem[], tiles: readonly ResolvedSettingsTile[], caps: Capabilities): HelpDoc[]` (sorted by `HELP_AREAS` index, `order`, `id`); `localized(doc, locale): {title; summary; blocks; fallback: boolean}`; `toIndex(docs, nav, tiles, locale): HelpIndexEntry[]` (`routes` = hrefs of available targets plus `doc.routes`, deduped; `headings` from `h` blocks); `visibleHelp(docs, nav, tiles, caps, locale): {docs: HelpDoc[]; entries: HelpIndexEntry[]}`.
  - `search.ts`: `matchHelp(entries, query): HelpIndexEntry[]`; `docForPath(entries, pathname): HelpIndexEntry | undefined`.

- [ ] **Step 1: Write the failing tests.**
  - `resolve.test.ts` (build `nav`/`tiles` with `resolveNavAll`/`resolveSettings` over small fixtures so locked/comingSoon come from the real resolver): `shows a doc whose screen is built`; `hides a doc whose screen is comingSoon`; `removes (does not lock) a doc when the plan lacks the screen's feature` (nav gated `planFeature:'sales_pipeline'`, caps features lack it → hidden); `hides a doc whose own gates.planFeature is missing`; `hides a doc when the person lacks the permission` (screen removed by the resolver); `is visible when one of two documented screens is available` ; `a guide with no documents is visible unless its own gates fail`; `shows everything when capabilities are unknown (null)`; `hides operator-audience docs`; `sorts by area, order, id`; `localized falls back to English with fallback=true`; `localized returns the translation when present`; `toIndex routes include hrefs of available targets only plus explicit routes, deduped`.
  - `blocks.test.ts`: `leadParagraph without anchor returns first paragraph`; `with anchor returns the paragraph under that heading and stops at the next h2`; `returns null for a missing anchor` and `trims to 240 chars with an ellipsis` (Review Focus 5); `degradeDocLinks turns an invisible help: link into text and leaves visible ones`; `plainText joins inline runs`.
  - `search.test.ts`: `empty or whitespace query returns all in original order`; `every token must match`; `title outranks keyword outranks heading outranks summary`; `is case-insensitive and treats regex characters literally` (query `(`); `docForPath picks the longest covering route`; `/ only matches exactly`; `ignores a trailing slash, query and hash`; `returns undefined under /help and for no match` (Review Focus 4).
- [ ] **Step 2: Run** the three files → FAIL.
- [ ] **Step 3: Implement** the signatures above. `resolveHelp` rules in order: audience `workspace`; if `documents` is non-empty, at least one `nav:<id>` is in `nav` with `!comingSoon && !locked` or one `tile:<id>` likewise; `evaluateGates(doc.gates, caps)` is non-null and not locked. `matchHelp` scores title 4, keywords 3, headings 2, summary 1 over lowercase `includes`; ties keep input order. `docForPath` strips `?`/`#` and a trailing `/` (except root), uses the same prefix rule as `matchesHref` in `components/shell/nav-model.ts` (root matches only itself).
- [ ] **Step 4: Run** → all PASS.
- [ ] **Step 5: Checkpoint.** lint and typecheck clean.

---

### Task 4: Provider, server loader and layout wiring

**Files:**

- Create: `apps/web/src/features/help-center/{context.tsx,server.ts,index.ts}`
- Modify: `apps/web/src/app/(app)/layout.tsx`
- Test: `context.test.tsx`

**Interfaces:**

- Consumes: `visibleHelp`, `HELP_DOCS` (Tasks 2 and 3), `getSession` from `@/lib/auth/server`, `fetchEnabledFeatures` from `@/features/plans-subscriptions-trials/server`, `resolveNavAll`, `resolveSettings`, `NAV`, `PLANNED_NAV`, `SETTINGS`, `PLANNED_SETTINGS`.
- Produces: `HelpProvider({entries, children})`, `useHelpEntries(): readonly HelpIndexEntry[]`, `useHelpEntry(id: string): HelpIndexEntry | undefined` (client, from `context.tsx`, re-exported by `index.ts`); `getVisibleHelp(): Promise<{docs: HelpDoc[]; entries: HelpIndexEntry[]} | null>` (`server.ts`, `import 'server-only'`, null when signed out; not re-exported by `index.ts`).

- [ ] **Step 1: Write the failing test** `context.test.tsx` (render with `renderToString` from `react-dom/server`): a consumer inside `HelpProvider entries=[e1]` prints the entry title for `useHelpEntry('e1')` and `none` for `useHelpEntry('x')`; outside a provider `useHelpEntries()` returns `[]`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `context.tsx` (`createContext<readonly HelpIndexEntry[]>([])`). `server.ts`: build `Capabilities` exactly as `(app)/layout.tsx` does (`permissions` from `session.permissions` keys, `planFeatures` from `fetchEnabledFeatures()`), then `visibleHelp(HELP_DOCS, resolveNavAll(NAV, caps, {planned: PLANNED_NAV}), resolveSettings(SETTINGS, caps, {planned: PLANNED_SETTINGS}), caps, await getLocale())`. `layout.tsx`: after `capabilities`, compute the same call with the `capabilities` already there (locale from `next-intl/server` `getLocale()`), and wrap `<WalletAppShell …>` in `<HelpProvider entries={view.entries}>`; no other line changes. Note: `/help` pages call `fetchEnabledFeatures()` again (one extra entitlement request on help pages only; accepted).
- [ ] **Step 4: Run** → PASS; then `pnpm --filter @crm/web typecheck`.
- [ ] **Step 5: Checkpoint.** Start the app (`.claude/skills/setup` if not running) and load `/`: no console errors, page unchanged.

---

### Task 5: Help screens, renderer, messages, guide docs

**Files:**

- Create: `app/(app)/(help-center)/help/page.tsx`, `app/(app)/(help-center)/help/[id]/page.tsx`, `features/help-center/{doc-body.tsx,help-home.tsx,help-search.tsx,hash-focus.tsx}`, `messages/en/help-center.json`, `messages/ar/help-center.json`, `features/help-center/help/getting-started.md`, `features/help-center/help/using-help.md`
- Test: `doc-body.test.tsx`, `help-home.test.tsx`, `messages.test.ts`; extend `generated.test.ts`

**Interfaces:**

- Consumes: `getVisibleHelp` (Task 4), `localized`, `degradeDocLinks`, `matchHelp`, `HelpIndexEntry`.
- Produces: `DocBody({blocks, visibleIds}: {blocks: HelpBlock[]; visibleIds: ReadonlySet<string>})`; `HelpHome({entries}: {entries: HelpIndexEntry[]})` (server-safe, groups by `HELP_AREAS` with `t('help.areas.<area>')` headings, renders `HelpSearch`); `HelpSearch({entries})` (client: input, filters with `matchHelp`, `role="status"` result count, empty state `help.noResults.*`); `HashFocus()` (client: focuses the element matching `location.hash` on mount and `hashchange`, headings carry `tabIndex={-1}`).
- Message keys under `help`: `title`, `subtitle`, `searchLabel`, `searchPlaceholder`, `resultsStatus` (ICU plural `{count}`), `noResults.title`, `noResults.message`, `areas.{overview,inbox,audience,sales,campaigns,automation,store,apps,settings,account,getting-started}`, `onThisPage`, `related`, `openScreen`, `allHelp`, `shownInEnglish`, `tip.label` (`{title}`), `tip.readMore`, `tip.close`.

- [ ] **Step 1: Write the failing tests.**
  - `doc-body.test.tsx`: renders `h2` with its `id`, `p`, `ul`/`ol`, a `note` with `role="note"`, a `link` as `<a href>`, a `doc` link to a visible id as `<a href="/help/<id>">`, to an invisible id as plain text; strings are HTML-escaped (`<script>` in a text node renders as `&lt;script&gt;`).
  - `help-home.test.tsx`: two entries in different areas render two area headings in `HELP_AREAS` order with their titles linking to `/help/<id>`; zero entries render the empty state.
  - `messages.test.ts`: `ar` has exactly the keys `en` has; every static `t('…')` key used in `features/help-center/*.tsx` exists (same pattern as `features/settings-hub/messages.test.ts`).
  - `generated.test.ts`: add `getting-started and using-help exist, are in area getting-started, and have no gates`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `/help` page: `const view = await getVisibleHelp()`; render `HelpHome`. `/help/[id]/page.tsx` (`params` is a Promise in Next 16): `view.docs.find(id)` else `notFound()`; render breadcrumb "All help", `<h1>` title, summary, `DocBody` (using `localized(doc, locale)`; show `help.shownInEnglish` note when `fallback`), "On this page" list of `h2`/`h3` anchors (hidden when fewer than 2 headings), related docs (same area, up to 4, from `view.entries`), and an "Open this screen" `Link` to the first available documented href. Layout is a single column with `max-w-3xl`, headings `scroll-mt-20`. Write both guide docs (what Help is, how plan features hide docs, how to read a tooltip; and a short getting-started). Arabic strings translated.
- [ ] **Step 4: Run** → PASS. Then load `/help` and `/help/getting-started` in the running app: lists render, search filters, an unknown id returns the 404 page.
- [ ] **Step 5: Checkpoint.** lint and typecheck clean.

---

### Task 6: The Help icon above Settings

**Files:**

- Create: `features/help-center/nav.ts`
- Modify: `components/shell/nav-rail.tsx` (the two `aria-label={t('shell.settings')}` at the pinned bottom `<nav>` of `NavRail` and `NavDrawer`), `messages/{en,ar}/shell.json` (add `shell.pinned`: "Help and settings" / Arabic), `features/_registry/types.ts` (comment on the `settings` group)
- Test: `features/help-center/nav.test.ts`

**Interfaces:**

- Produces: `nav: NavItem[]` = `[{ id: 'help-center', group: 'settings', labelKey: 'shell.help', href: '/help', order: -10, icon: 'help' }]` (the key `shell.help` = "Help" already exists).

- [ ] **Step 1: Write the failing test** `nav.test.ts`: `resolveNav([...NAV], CAPABILITIES_UNKNOWN)` places `help-center` immediately before `settings` in the `settings` group; `splitBottom`-equivalent via `toSections(menuItems(...))` yields both in that order; `activeNavId(items, [], '/help/getting-started')` is `help-center`; `/helpful` is not.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `nav.ts`; regenerate the registry (`node scripts/gen-registry.mjs`); change the two aria-labels to `t('shell.pinned')`; update the `types.ts` comment to "`settings` holds the entries pinned to the bottom of the menu (Help, Settings)".
- [ ] **Step 4: Run** `nav.test.ts` and the existing shell tests (`src/components/shell`, `src/features/_registry`, `src/features/settings-hub`) → PASS.
- [ ] **Step 5: Checkpoint.** In the running app the rail shows Help directly above Settings (hover tooltip "Help"), the mobile drawer lists it above Settings, and `/help` highlights it.

---

### Task 7: HelpTip, page-level tip, top bar slot

**Files:**

- Create: `features/help-center/{help-tip.tsx,actions.ts}`
- Modify: `components/shell/top-bar.tsx` (new optional prop `pageHelp?: ReactNode`, rendered immediately before `{pageSettings}`), `components/shell/app-shell.tsx` (`pageHelp={<PageHelpTip />}`), `features/help-center/index.ts` (export `HelpTip`, `PageHelpTip`)
- Test: `help-tip.test.tsx`, `actions.test.ts`

**Interfaces:**

- Consumes: `useHelpEntry`, `useHelpEntries`, `docForPath` (Tasks 3 and 4), `Popover` from `@crm/ui`, `NavIcon`.
- Produces: `HelpTip({doc, anchor?, className?}: {doc: string; anchor?: string; className?: string}): JSX.Element | null`; `PageHelpTip(): JSX.Element | null`; `tipHref(doc: string, anchor?: string): string` (`/help/<doc>` plus `#<anchor>`); `getHelpTip(doc: string, anchor: string): Promise<string | null>` (`'use server'`; takes the locale from `getLocale()` of `next-intl/server`; returns null for malformed input, a doc the person cannot see, or an unknown anchor).

- [ ] **Step 1: Write the failing tests.**
  - `help-tip.test.tsx` (SSR, closed state): renders `null` for an id absent from the provider; renders one `<button>` with `aria-expanded="false"`, `aria-haspopup="dialog"` and an accessible name from `help.tip.label` for a present id; `tipHref('contacts','duplicates')` is `/help/contacts#duplicates` and without anchor `/help/contacts`; `PageHelpTip` renders nothing under `/help/...` and for an uncovered path (use the pure `docForPath`; the component takes `pathname` from `usePathname`, mocked with `vi.mock('next/navigation')`).
  - `actions.test.ts`: with `getVisibleHelp` mocked (`vi.mock('./server')`) and `getLocale` mocked (`vi.mock('next-intl/server')`) — returns the lead paragraph for a visible doc and anchor; `null` for an invalid anchor string (`'../x'`), an unknown doc, an unknown anchor, and when `getVisibleHelp` returns `null`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `HelpTip`: a `relative inline-flex` wrapper, a real `<button>` (icon `help`, `size-4`, focus ring as in `top-bar.tsx`) toggling `Popover` (`label` = the doc title); content is the doc `summary`, replaced by the section text after the first open when `anchor` is set (call `getHelpTip` once in an effect; on `null` keep the summary); always a `Link` "Read more" (`help.tip.readMore`) to `tipHref`; closing via Escape or the link returns focus to the button (the `Popover` closes on Escape and outside press; focus return is done in `onClose`). No hover-only behaviour. `actions.ts` validates `anchor` against `/^[a-z0-9-]{1,80}$/` and `doc` against the id pattern before any lookup.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @crm/web typecheck`.
- [ ] **Step 5: Checkpoint.** In the running app on a documented screen the "?" appears left of the settings gear, opens, shows the summary, and its link lands on the doc (needs Task 10's docs; until then verify on `/help` that no tip renders, and temporarily on a screen covered by `getting-started` via an explicit `routes:` entry, then remove that entry).

---

### Task 8: Coverage rules and the pending report

**Files:**

- Create: `features/help-center/{coverage.ts,coverage.test.ts,pending-report.test.ts}`, `features/help-center/pending.json` (initially `{"pending": []}`)

**Interfaces:**

- Consumes: `NavItem`, `SettingsTile`, `HelpDoc`, `PLAN_FEATURE_KEYS` from `@crm/contracts`.
- Produces: `type PendingEntry = {unit: string; owner: 'lakshya' | 'vedant' | 'punya'; reason: string}`; `unitsOf(nav, tiles, planFeatureKeys): string[]` (`nav:<id>`, `tile:<id>`, `feature:<key>`, deduped, sorted); `coverage({nav, tiles, docs, planFeatureKeys, pending}): {undocumented: string[]; stalePending: string[]; badPending: string[]}`. A unit is covered by a doc `documents` entry; `feature:K` is covered by a doc with `gates.planFeature === K` or a doc that documents a nav item or tile whose `gates.planFeature === K`. `stalePending` = pending units that are now covered or are not units any more; `badPending` = entries with an unknown owner or an empty reason. `undocumented` excludes pending units.

- [ ] **Step 1: Write the failing tests** `coverage.test.ts`: `an undocumented nav item is reported as nav:<id>`; `a tile is covered by a doc listing tile:<id>`; `feature:K covered via gates.planFeature`; `feature:K covered via a documented screen whose own gates carry it`; `pending units are excluded from undocumented`; `a documented pending unit is stale`; `a pending unit that is not a unit is stale`; `unknown owner and blank reason are bad`; `unitsOf dedupes and sorts`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `coverage.ts`. `pending-report.test.ts` uses `it.runIf(process.env.HELP_WRITE_PENDING === '1')`: compute the report from the real generated registries and `pending.json`, find each unit's domain by searching `features/*/nav.ts` and `settings.ts` for `id: '<unit id>'` (plan features belong to `plans-subscriptions-trials`), map to the owner through `docs/threadwise-port/ownership.json` `domains[].owner`, and write `docs/help-pending.md` with first line `<!-- help-pending: N -->` followed by units grouped by domain and owner, or `All features have help docs.` when empty. Never fails.
- [ ] **Step 4: Run** `coverage.test.ts` → PASS. Run `HELP_WRITE_PENDING=1 node node_modules/vitest/vitest.mjs run src/features/help-center/pending-report.test.ts` and read `docs/help-pending.md` (about 70 screens and the plan features, nearly all undocumented at this point).
- [ ] **Step 5: Checkpoint.** lint and typecheck clean.

---

### Task 9: Automation: skill, hooks, rules

**Files:**

- Create: `.claude/skills/help-docs-sync/SKILL.md`, `.claude/skills/help-docs-sync/scripts/pending.sh`, `.claude/skills/help-docs-sync/scripts/session_start.sh`, `.husky/post-merge`
- Modify: `.claude/settings.json` (add a `SessionStart` hook beside the existing `Stop`), `.claude/skills/README.md` (row), `.claude/skills/threadwise-port-feature/SKILL.md` (a step before parity), `CLAUDE.md` (a section next to the parity rule), `.claude/skills/threadwise-ownership-guard/scripts/gen_ownership.py` and regenerated `docs/threadwise-port/ownership.json`

**Interfaces:**

- `pending.sh [--quiet]`: runs `pending-report.test.ts` with `HELP_WRITE_PENDING=1` from `apps/web` (`node "${HELP_VITEST:-node_modules/vitest/vitest.mjs}" run …`; `HELP_VITEST` exists so the script test can point it at nothing), prints `N features have no help doc: docs/help-pending.md` unless `N` is 0 or `--quiet` is given, always exits 0.
- `session_start.sh`: reads the first line of `docs/help-pending.md` if present; when N is above 0 prints JSON `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<N> features have no help doc (docs/help-pending.md). Invoke the help-docs-sync skill and draft them before other work."}}`; prints nothing when the file is missing or N is 0; exits 0.
- Skill content: when to run (after building or changing any screen, after a pull, when the SessionStart note appears), the steps from spec section 6 item 5, the doc template (what it is for, steps, settings, limits and plan requirements, if something looks wrong), the writing rules, how to add a `pending.json` entry (owner and reason required) when a screen cannot be documented honestly yet, and the commands to regenerate and test.
- `gen_ownership.py` `SEAMS` gains three entries (reviewer `lakshya`): `apps/web/src/features/help-center/**` and `apps/web/src/app/(app)/(help-center)/**` ("Help center zone: repo owner"), and `apps/web/src/features/*/help/**` ("first content pass adds new files into every domain; afterwards each domain owner edits their own docs").

- [ ] **Step 1: Write the failing checks as a shell test** in `.claude/skills/help-docs-sync/scripts/test_scripts.sh` (pattern: `threadwise-playwright-parity/scripts/test_scripts.py`, but plain bash): `session_start.sh` prints nothing for a file whose first line is `<!-- help-pending: 0 -->` and for a missing file; prints the JSON above (parse it with `node -e`) for `<!-- help-pending: 3 -->`; `pending.sh` exits 0 even when vitest is missing (simulate with a bad path env override `HELP_VITEST=/nonexistent`).
- [ ] **Step 2: Run** `bash .claude/skills/help-docs-sync/scripts/test_scripts.sh` → FAIL (scripts missing).
- [ ] **Step 3: Implement** the scripts, skill, hooks and rule text (`CLAUDE.md`: "Every feature gets a help doc (automatic)": after you build or change any screen, invoke `help-docs-sync` before saying it is done; after the owner pulls or when the SessionStart note says features lack docs, draft them without being asked; a doc is gated like its screen; link `docs/specs/help-center.md`). `.husky/post-merge`: `bash .claude/skills/help-docs-sync/scripts/pending.sh || true`. `threadwise-port-feature`: add "Help doc: invoke `help-docs-sync` for the screens this feature adds" between the web step and parity. Regenerate ownership: `python .claude/skills/threadwise-ownership-guard/scripts/gen_ownership.py`.
- [ ] **Step 4: Run** the shell test → PASS; run `pending.sh` for real and see the count line; `python .claude/skills/threadwise-ownership-guard/scripts/ownership_check.py` still reports nothing new for tracked files.
- [ ] **Step 5: Checkpoint.** `git diff --stat` for these paths only. Note for the owner: `ownership.json`/`assignment` seams need all three developers' approval (their policy); and `git config core.hooksPath` is empty in this checkout, so the husky hook only fires where `pnpm install` has installed hooks (the SessionStart hook and the skill cover Claude sessions regardless).

---

### Task 10: First content pass (parallel sub-agents)

**Files:**

- Create: `apps/web/src/features/<domain>/help/<slug>.md` for every domain that has a built screen (new files only; no existing file is edited), No `<HelpTip>` is added in this pass: it would edit other people's existing page files, and the automatic page-level tip already covers every documented screen. Section-level tips are added later by each domain owner inside their own files.

**Interfaces:**

- Consumes: the `help-docs-sync` skill (Task 9), `docs/help-pending.md` (the work list), each domain's `docs/threadwise-port/wiring/<domain>.md` and inventory entry, and the built screens under `app/(app)/(<domain>)/`.
- Produces: one doc per documented unit (nav item or tile), with `documents`, `area`, `order`, `summary` (at most 160 characters) and gates only where the doc adds one beyond its screen; a few guide docs (plans and billing basics, roles and permissions basics) in `plans-subscriptions-trials/help/` and `roles-permissions/help/`.

- [ ] **Step 1: Partition.** Read `docs/help-pending.md`; split its domains into batches of about 6 to 8 domains each (target 6 to 7 batches), keeping one domain's units in one batch.
- [ ] **Step 2: Dispatch** one general-purpose sub-agent per batch in a single message (parallel). Each prompt contains: the skill path to read first, the batch's domains and units, the rule "new files only under `features/<domain>/help/`, describe only behaviour that exists in the build, our own words, no Reference text", the frontmatter and subset rules from this plan's Global Constraints, the command to compile (`node apps/web/scripts/gen-registry.mjs`) and test (`cd apps/web && node node_modules/vitest/vitest.mjs run src/features/help-center`), and the instruction to report units it could not document honestly (with reason) instead of inventing text.
- [ ] **Step 3: Collect and compile.** `node apps/web/scripts/gen-registry.mjs` must succeed; fix any compile error by editing the offending doc.
- [ ] **Step 4: Review a sample.** For each batch, open two docs against the running screen and check each stated behaviour exists; fix or remove what does not. Record rejected claims in the batch report.
- [ ] **Step 5: Regenerate the report.** `bash .claude/skills/help-docs-sync/scripts/pending.sh` → the count falls to the units the agents reported as undocumentable. Checkpoint: list the remaining units for Task 11.

---

### Task 11: The coverage gate and pending list

**Files:**

- Create: `features/help-center/coverage.gate.test.ts`
- Modify: `features/help-center/pending.json`, `features/help-center/registry.test.ts` (new, semantic validation)

**Interfaces:**

- Consumes: `coverage`, `HELP_DOCS`, `NAV`, `SETTINGS`, `PLAN_FEATURE_KEYS`, `isPlanFeatureKey`.

- [ ] **Step 1: Write the failing tests.**
  - `coverage.gate.test.ts`: `every built screen and plan feature has a doc or a pending entry` (asserts `undocumented` is `[]` and prints the list in the failure message); `pending.json has no stale or bad entries`.
  - `registry.test.ts` (semantic checks the generator cannot do): every `documents` entry resolves to a declared `NAV` item or `SETTINGS` tile and not to a planned one; every `gates.planFeature` satisfies `isPlanFeatureKey`; every doc `area` matches its target's menu group when it documents a nav item (a doc may sit in a different area only if `area` is `settings`, `account` or `getting-started`); a doc with neither `documents` nor `gates.planFeature` is in area `getting-started`.
- [ ] **Step 2: Run** → FAIL while `pending.json` is empty and gaps remain.
- [ ] **Step 3: Fill `pending.json`** with one entry per remaining unit from Task 10's report: `unit`, `owner` from the report's grouping, and a specific `reason` (for example "screen is mid-port; behaviour not final").
- [ ] **Step 4: Run** `node node_modules/vitest/vitest.mjs run src/features/help-center` → all PASS; then `bash .claude/skills/pre-pr/scripts/gate.sh` for format, lint, typecheck, boundaries and the whole unit suite.
- [ ] **Step 5: Checkpoint.** Delete the pending entry of any unit documented in a later change; the gate fails on stale entries, so this cannot rot silently.

---

### Task 12: End-to-end

**Files:**

- Create: `apps/web/e2e/help-center/help.spec.ts`

**Interfaces:**

- Consumes: the seeded workspace admin (`nachiket.challawar@geta.ai`, org `Admin`, `Passw0rd!` via `/api/auth/login`, as `e2e/workspaces-teams-tenancy/members-teams.spec.ts` does), a `hydrated(page)` helper copied from that spec.

- [ ] **Step 1: Write the specs** (they fail until the feature runs): `Help sits directly above Settings in the rail` (both `a[aria-label="Help"]` and `a[aria-label="Settings"]` inside the pinned nav; Help's bounding box top is above Settings') and `in the mobile drawer` (viewport 390x844, open the menu); `/help lists grouped docs and search filters them` (type a known doc title, result count changes, clearing restores); `a doc page renders with an On this page list and a working #heading link`; `an unknown doc id returns 404`; `a doc gated on a plan feature the workspace lacks is absent from /help, from search and from its URL` (read entitlements with the access cookie as Bearer against the API at `API_URL ?? http://localhost:3000/v2/billing/entitlements`, pick a doc from the compiled registry gated on a feature not in that list, assert its title is absent from `/help` and `/help/<id>` is 404; `test.skip` with the message "no plan-gated doc is missing a feature on the seeded plan" only when no such pair exists); `the page tooltip opens, shows the summary and links to the doc` (on `/contacts`: press the "?" button, see the summary, click Read more, land on `/help/<id>`; Escape closes and returns focus).
- [ ] **Step 2: Run** with the local workaround from the memory note `reference_web_e2e_local_run` (throwaway `zz-local.playwright.config.ts` pointing at the installed Chromium 1228, `HEADLESS=1`); delete the config and `e2e/.results/` afterwards.
- [ ] **Step 3: Fix** what the run shows until all pass; the skip counts as honest only for the gated-doc case.
- [ ] **Step 4: Checkpoint.** The spec file is the only new e2e file; nothing else under `e2e/` changes.

---

### Task 13: Verification, parity record, spec reconciliation

**Files:**

- Create: `docs/threadwise-port/parity/help-center.md`
- Modify: `docs/specs/help-center.md` (amendments below), `docs/threadwise-port/README.md` only if it indexes parity files

- [ ] **Step 1: Run the whole gate:** `bash .claude/skills/pre-pr/scripts/gate.sh` (format, lint, typecheck, boundaries, unit tests); fix what fails in files this plan touched; report any failure that comes from another person's uncommitted work without changing it.
- [ ] **Step 2: Walk it in the running app** (built-in browser): Help above Settings (rail and drawer); `/help` and a doc; the "?" on three documented screens; then, as an operator, remove one plan feature from the workspace's plan (or use a second workspace on a plan without it) and confirm that feature's docs vanish from `/help`, search and tips on the next load and its URL is 404; restore the plan. Screenshots are for me; none are committed.
- [ ] **Step 3: Parity.** Invoke `threadwise-playwright-parity`. It has no Reference surface for Help (Guidebook is untouched) so it records that itself; write `docs/threadwise-port/parity/help-center.md` with two intended differences: the Help entry in the rail and the Help center screens exist only here; docs are plan-aware. No `skipped --user-approved` stamp is used because the owner did not give that word.
- [ ] **Step 4: Check the spec still matches** what was built; the decisions below were already applied to it while planning, so only real deviations need a spec edit.
- [ ] **Step 5: Final report to the owner:** what shipped, the pending list size by owner, the approvals still needed (seams in `ownership.json`), and that nothing is committed.

**Decisions made while planning (already applied to the spec):**

1. 4.2: semantic checks (documents resolve, plan feature key valid, area matches) run in `registry.test.ts`, not in the generator; the generator checks syntax, unique ids, `help:` targets and translation twins and exits non-zero on error. The second generated file (`help-index.generated.ts`) is dropped: the index is built per request by `toIndex`.
2. 4.3: a doc with several `documents` is visible when at least one is available; the screen's own plan gate is applied through the resolved nav (`locked` hides the doc).
3. 4.1: translation files carry their own `title` and `summary`; frontmatter has no inline comments.
4. 4.5: the pinned `<nav>` landmark label changes from "Settings" to "Help and settings" (`shell.pinned`) because it now holds both.
5. 6: the SessionStart hook reads `docs/help-pending.md` (written by the post-merge hook and by the gate) instead of running vitest; the strict coverage test is introduced after the first content pass so `pnpm test` is green at every step; the report writer is a vitest file gated by `HELP_WRITE_PENDING=1` (no `package.json` edit).
6. 8: ownership seams are added in `gen_ownership.py`'s `SEAMS` (no new "domain", which would require inventory and tracker rows).
7. 4.6 and 6: section-level `<HelpTip>`s are added only inside the owner's own domain files; the first content pass adds none.
8. 9: parity is run through `threadwise-playwright-parity`, which records "no comparable surface" itself; no `skipped --user-approved` stamp is used.
