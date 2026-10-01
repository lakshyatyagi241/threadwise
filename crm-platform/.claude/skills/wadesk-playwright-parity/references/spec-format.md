# Twin spec format

A twin spec says **what to run on both apps**: which pages, forms, lists and custom flows exist, and how to find things on each side. The harness expands it into the full scenario matrix (hundreds of cases for a form), runs it on WaDesk and on our app, and compares.

Where it lives: `apps/web/e2e/<domain>/parity/<WD-ID>.twin.mjs` (inside the domain's zone; `adhoc-<slug>.twin.mjs` for a feature WaDesk does not have). Plain ES module, no build step, no imports needed. Worked examples next to the harness: `harness/specs/example.pages.twin.mjs` (pages only, writes nothing), `example.contacts-api.twin.mjs` (API-level), `selftest.contacts.twin.mjs` (form + list + delete on a real WaDesk screen).

```js
export default (h) => ({
  feature: 'WD-CON-004', // inventory id, or 'adhoc:<slug>'
  title: 'Create contact',
  pages: [...], forms: [...], lists: [...], deletes: [...], scenarios: [...],
  intended: [...], skip: [...], severity: {...}, teardown: ...,
});
```

`h` carries `h.ALL_PAGE_PROBES`, `h.casesFor(field, depth)`, `h.pick`, `h.cfg` and the generators (`h.formScenarios(form)`, `h.pageScenarios(page)`, ...) for composing your own scenario lists.

## Per-side values

Anything that differs between the apps is written `{ wadesk: ..., ours: ... }` (or `{ both: ... }`). A value that is not side-keyed (a function, a string, a locator spec) is shared. WaDesk's markup and wording are different from ours on purpose, so locators are per side; **logical names** (field ids, scenario ids) are shared.

## Locator specs

A string is CSS. An object is one of: `{css}`, `{testid}`, `{role, name, exact, level}`, `{label}`, `{placeholder}`, `{text}`, `{any: [spec, spec]}` (first that matches). Add `has: spec` to require a descendant and `nth: n | 'last'`. A function `(root) => Locator` is allowed. Regular expressions are fine (the spec is JavaScript). Use `node harness/explore.mjs <side> <path> [--click "Add contact"] [--root "#form"]` to read field names, labels and buttons off a real screen instead of guessing.

## pages[]

```js
{ id: 'contacts', title: 'Contacts list', path: '/contacts'            // or { wadesk: '/contacts', ours: '/people' }
  ready: { wadesk: 'table', ours: 'main' },                             // proves the page rendered
  public: false,                                                        // true: opened without a session (login, signup)
  probes: ['load','responsive','a11y','keyboard','degraded','auth','perf'] }  // default: all; --depth quick: load, a11y, auth
```

Probes need no feature knowledge: load noise (console errors, failed requests, 4xx/5xx, broken images), structure, three viewports, axe-core, Tab traversal, "data requests fail with 500" behaviour, access without a session, median-of-three timing.

## forms[]

```js
{ id: 'contact-create', title: 'Add contact',
  open: { wadesk: async (c) => {...}, ours: async (c) => {...} },   // leave the form visible
  root: { wadesk: '#addContactForm', ours: 'form[data-testid=contact]' },
  submit: { wadesk: 'button[type=submit]', ours: { role: 'button', name: /save/i } },
  cancel: { role: 'button', name: /cancel/i },                      // optional: enables cancel-dirty
  valid: (c) => ({ title: { option: 'first' }, mobile: '9' + c.digits(9) }),   // baseline that must be accepted (object or fn)
  tagField: ['first_name', 'last_name'],                            // field(s) that carry the run's test-data tag
  fields: [
    { id: 'first_name', type: 'name', required: true, max: 191, loc: { wadesk: '[name=first_name]', ours: { label: /name/i } } },
    { id: 'mobile', type: 'phone', required: true, unique: true, sample: (c) => '9' + c.digits(9), loc: {...} },
    { id: 'title', type: 'select', required: true, loc: {...} },
  ],
  readback: { wadesk: async (c, { values, tag }) => ({ name: '...' }), ours: ... },  // optional: stored values, compared
  cleanup: ..., countAfter: ... }                                   // optional
```

Field `type` picks the edge-case catalogue (`harness/lib/values.mjs`): `text name textarea slug company address search email phone tel number integer money decimal url date datetime password select checkbox switch`. `file` fields get no generated cases: write a custom scenario. Extras: `cases: [{id, value, why}]` adds cases, `skipCases: ['emoji']` drops some, `skipMatrix: true` keeps the field in the form but not in the matrix.

Per form the generator produces: structure (fields present, kinds, required, limits, labels, tab order), happy path (+ readback), all-empty, each required field blank, the per-field value matrix, duplicates for `unique` fields (exact / case / padded), Enter key submits, double submit, slow server (progress shown, repeat blocked), server error (XHR 500: feedback, values kept, submit usable), offline, session expired, cancel with typed data then reopen. Depth `quick` runs structure, happy, all-empty, required and a short value list; `standard` adds the UX/network behaviours and more values; `full` is everything.

Every accepted submit is checked for stored-value differences (when `readback` is given) and for script execution (`sec.xssExecuted`).

## lists[] and deletes[]

```js
lists: [{ id: 'contacts-list', title: 'Contacts', page: '/contacts', ready: 'table',
  rows: { wadesk: 'tbody tr', ours: '[role=row]' },
  search: { input: {...}, submit: 'enter' | locator, term: 'text that exists on both sides' },
  sorts: [{ id: 'name', header: {...}, col: { wadesk: 1, ours: 0 } }],
  filters: [{ id: 'group', control: {...}, option: 'value' }],
  more: { wadesk: ..., ours: ... },                 // load-more / next page control
  rowOpen: { wadesk: 'tbody tr a', ours: ... } }]

deletes: [{ id: 'contact-delete', title: 'Delete contact', page: '/contacts',
  seed: { wadesk: async (c) => ({ tag }), ours: ... },   // create a row; returns what row() needs
  row: { wadesk: (made, c) => c.page.locator('tbody tr', { hasText: made.tag }), ours: ... },
  start: { wadesk: async (c, row) => {...} },            // trigger the delete UI
  confirm: {...}, cancel: {...} }]
```

Lists compare behaviour, not data (the datasets differ): a miss shows an empty state, search edge cases do not crash or execute script, a sort click reorders, a filter narrows and survives reload, load-more adds rows, a row opens and Back returns. Deletes compare: confirmation shown, cancel keeps the row, confirm removes it, it stays gone after reload.

## scenarios[] (anything else)

```js
{ id: 'contact-api.create.name-spaces', title: '...', tags: ['edge'],
  api: true,              // no browser page: use c.http(); needsUi:false
  loggedIn: false,        // open without a session
  role: 'admin',
  run: async (c) => {...}  // one function for both sides (branch on c.side), or { wadesk: fn, ours: fn }
}
```

Inside `run`, record **side-neutral observations** with `c.obs` (below) and never assert: the comparator does that.

## Scenario context `c`

| Member                                                     | Use                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `c.side`, `c.page`, `c.context`, `c.request`, `c.rec`      | the side name, a fresh logged-in page/context, an API client for the side, the traffic recorder                     |
| `c.goto(path \| {wadesk, ours}, {ready})`                  | navigate and wait until the app is really done (load + quiet network, tolerant of polling)                          |
| `c.loc(spec, root?)`, `c.visible(spec)`                    | locator from a spec                                                                                                 |
| `c.click(spec)`, `c.fill(spec, v)`, `c.press(key)`         | counted user actions (UX friction metric)                                                                           |
| `c.afterAction({quiet})`                                   | wait for the reaction to the last click/keypress (a request, a navigation, a re-render)                             |
| `c.step(name, fn)`                                         | label a step; failures say which one                                                                                |
| `c.snap(label)`, `c.shot(label)`                           | semantic snapshot / screenshot, kept in the run directory                                                           |
| `c.openAlso({viewport, role, loggedIn})`                   | another isolated context (mobile viewport, other role, logged out); closed for you                                  |
| `c.failRequests(match, 500 \| 'abort' \| {delay}, {})`     | inject failures; returns an async disposer                                                                          |
| `c.http(method, path, {data, form, multipart, anonymous})` | API call on this side (WaDesk gets CSRF + XHR headers on writes)                                                    |
| `c.tag(label)`, `c.digits(n)`                              | test data tagged with the run id; `digits` is deterministic per run + scenario, so both apps receive the same value |
| `c.isMine(record)`, `c.deleteOwned(path, record)`          | true / delete only when the record carries this run's tag                                                           |
| `c.onCleanup(fn)`                                          | undo at the end of the scenario, even on failure                                                                    |

## Observation keys

The prefix decides how the comparator treats a value (full table with severities: `comparison-rules.md`).

| Prefix                                                | Recorded with                         | Meaning                                                                                                   |
| ----------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `flag.` `enum.` `set.` `seq.` `status.` `map.` `num.` | `o.flag/enum/list/seq/status/set/num` | must be equal on both sides                                                                               |
| `low.`                                                | `o.set('low.x', n)`                   | lower is better: ours may be equal or lower                                                               |
| `lowset.`                                             | `o.set('lowset.x', [...])`            | a set of problems: only problems ours has and WaDesk lacks count                                          |
| `abs.`                                                | `o.set('abs.x', v)`                   | higher is better: ours must be at least as good as WaDesk (or the best value when WaDesk has no baseline) |
| `sec.`                                                | `o.set('sec.x', bool)`                | `true` is a security violation: wrong on ours whatever WaDesk does                                        |
| `perf.`                                               | `o.set('perf.x', ms)`                 | ours may be up to 2.5x slower and 800 ms slower                                                           |
| `ui.`                                                 | `o.set('ui.x', v)`                    | structure: differences become **review** items, not failures                                              |
| `info.`                                               | `o.info('x', v)`                      | recorded for the report only (copy, texts)                                                                |

## intended[], skip[], severity{}

```js
intended: [
  { scenario: /phone-(letters|short|long)$/, key: 'enum.outcome', quirk: 'WaDesk accepts any text as a phone number',
    reason: 'we validate E.164; WaDesk stores garbage (a WaDesk bug we deliberately do not reproduce)' },
],
skip: [{ scenario: /live-session/, side: 'wadesk', reason: 'needs a paired WhatsApp device; compared from fixtures instead' }],
severity: { 'ui.table.0.columns': 'major' },     // raise a review key to a failure for this feature
```

A reason of at least eight characters is mandatory; an `intended` entry without one is itself reported as a defect. Architecture rules (cursor pagination, uuid ids, problem+json errors, hard delete, optimistic locking, tenant 404, Idempotency-Key) are matched automatically.

## teardown

`teardown: { wadesk: async (c) => ..., ours: async (c) => ... }` (or `both`) runs once per side after the scenarios and deletes what the run created, by tag. Prefer per-scenario `c.onCleanup` with `c.deleteOwned`.

## Authoring rules

1. Never write WaDesk's wording into a locator that ends up in our app, or into a message in our repo. Spec locators for the WaDesk side may match its text (they only run against it); keep that text out of everything under `apps/`.
2. Test data: every row you create carries the run tag (`c.tag()`), never a hard-coded value that a seed could contain, and is deleted only through `c.deleteOwned`. An API that de-duplicates answers a create with an _existing_ row; deleting it destroys seed data.
3. Do not fuzz credential forms (login, reset, MFA): lockouts. Use the page probes there.
4. No real provider calls, messages or payments. Provider-dependent flows get a `skip` with the reason and are compared from fixtures instead.
5. A scenario must be repeatable: it creates what it needs and does not rely on data left by another scenario.
