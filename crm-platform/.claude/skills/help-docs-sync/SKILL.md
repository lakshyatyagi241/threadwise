---
name: help-docs-sync
description: >-
  Write or update the in-app Help guides for the screens you built or changed, and draft the guides that are missing after a
  pull. Use this after building or changing ANY screen, Settings tile or plan feature, whenever someone says "document this
  feature", "write the help doc", "help guide", "pending docs", "docs for what I pulled", and whenever a session-start note says
  "N features have no help doc" or docs/help-pending.md lists units. A guide is gated like its screen: it shows only on plans
  and roles that have the feature and disappears when the feature or module is off. Never finish a feature without its guide, and
  never describe behaviour the build does not have.
---

# Help docs sync

The Help center (`/help`, the question mark above Settings, the "?" tips on pages) shows one guide per feature. Guides are
markdown files in each domain, checked in with the feature. This skill is how they stay complete: **whoever builds a feature writes
its guide in the same change, and after the owner pulls the team's work, every feature that arrived without a guide is listed and
drafted.** Design: [docs/specs/help-center.md](../../../docs/specs/help-center.md).

## When to run

- After you build or change any screen, Settings tile or plan feature (run it for that unit, before parity and before the PR).
- After a pull or merge: the husky `post-merge` hook prints `N features have no help doc` and writes `docs/help-pending.md`; a
  session-start note says the same. Draft those guides without being asked, then tell the user what you wrote.
- When asked about documentation coverage.

## Steps

1. **Find the work.** `bash .claude/skills/help-docs-sync/scripts/pending.sh` rewrites `docs/help-pending.md`: units grouped by
   domain and owner (`nav:<id>` a menu entry, `tile:<id>` a Settings tile, `feature:<key>` a plan feature). For a feature you just
   built, the work is the units you added.
2. **Understand the unit.** Read the domain's inventory entry (`docs/wadesk-port/inventory/<domain>.md`) and wiring map
   (`docs/wadesk-port/wiring/<domain>.md`), the screen's components under `features/<domain>/` and `app/(app)/(<domain>)/`,
   its `nav.ts` / `settings.ts` gates (plan feature, permission), and the real labels in `messages/en/<domain>.json`. Open the
   screen in the running app when you can. Describe **our** screen, not WaDesk's.
3. **Write `apps/web/src/features/<domain>/help/<slug>.md`.** Frontmatter:

   ```yaml
   ---
   id: contacts-overview # unique across the app, kebab-case; used in /help/<id> and <HelpTip doc="...">
   title: Contacts
   summary: Your customer list: add people, import them, group and search them. # at most 160 characters
   area: audience # the menu group of the screen (overview, inbox, audience, sales, campaigns, automation, store, apps),
   # or settings for a tile, account for an /account pane, getting-started for a guide
   order: 10
   documents: [nav:contacts] # nav:<id> and/or tile:<id> this guide explains; empty only for a guide spanning screens
   gates: # optional; only a requirement the screen itself does not already carry
     planFeature: sales_pipeline
   keywords: [customers, leads, people]
   ---
   ```

   Do not repeat the screen's own gates: a guide inherits them (no permission, locked plan feature or "coming soon" screen means no
   guide). Add `gates.planFeature` only when the guide covers something the plan adds beyond the screen. A guide for a plan
   feature that has no screen of its own (`feature:<key>`) is gated on it: `gates: { planFeature: <key> }`, `documents: []`.
   Optional `<slug>.ar.md` carries an Arabic `id`, `title`, `summary` and body (nothing else).

4. **Write the body** in the restricted subset: `##` and `###` headings, paragraphs, `-` and `1.` lists, `> ` callouts, `**bold**`,
   `` `code` ``, links `/app-path` and `[Name](help:other-guide-id)`. No HTML, images, tables, code fences, `#` titles or external
   links (the compiler rejects them). Shape: what it is for; how to use it, step by step; what each setting does; limits and plan
   requirements; if something looks wrong.
5. **Section tips** (your own domain's files only): where a control is not obvious, add `<HelpTip doc="<id>" anchor="<heading-id>" />`
   beside it; the first paragraph under that heading is the tip's text, so write it as a one-line answer.
6. **Cannot document it honestly yet** (the screen is mid-port, behaviour unsettled)? Add it to
   `apps/web/src/features/help-center/pending.json` as `{ "unit": "nav:x", "owner": "lakshya|vedant|punya", "reason": "<specific>" }`.
   An entry needs an owner and a reason, and goes away when the guide exists (the gate fails on a stale entry).
7. **Verify.** `node apps/web/scripts/gen-registry.mjs` (a bad file stops with its path and the rule),
   `cd apps/web && node node_modules/vitest/vitest.mjs run src/features/help-center` (the coverage gate fails on an undocumented
   unit), `bash .claude/skills/help-docs-sync/scripts/pending.sh` (the count falls), then the pre-PR gate.

## Rules that keep guides honest

- Describe only behaviour that exists in this build. Read the code or use the screen; do not infer from WaDesk or from the inventory.
- Our own words. WaDesk's copy-deck is never pasted (the port skill forbids it).
- Use the labels the screen shows. Say plainly which plan feature or role it needs.
- Never mention a screen that is only "coming soon". A guide for an unbuilt screen is hidden anyway, so write it when the screen lands.
- One idea per guide; link neighbours with `help:<id>` (a link to a guide the reader cannot see becomes plain text).

## Related

[`wadesk-port-feature`](../wadesk-port-feature/SKILL.md) calls this skill before parity. The repo `CLAUDE.md` makes it automatic.
