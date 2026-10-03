# Parity: marketing-site-cms (CMS)

**Twin run against the live Reference: partial.** Evidence is the inventory entry, the Reference source and automated tests against real Postgres.
Operator screens (`/admin/*`) sit behind operator MFA and were not opened in a browser in this run; the public site was smoke-tested once
(all ten public URLs answer 200 with no page errors). Run the twin before marking rows `verified`.

Tier P0 done: TW-CMS-001, 003, 006, 007, 008, 013, 018, 019, 024, 030, 034.
Tier P1 done: TW-CMS-002, 005, 009, 010, 011, 012, 014, 016, 017, 021, 022, 023, 025, 026, 028, 029, 031, 033, 036, 037, 039, 040, 042, 044, 045, 047, 048.
Tier P2 done: TW-CMS-004, 015, 020, 032, 035, 038, 041, 043, 046, 049, 050, 051, 052.

Automated: unit (`cms-rules`, `registry`, `guidebook-rules`, `privileged-access`: 55), API e2e (`cms.e2e` 69, `site.e2e` 22), integration (`cms-schema`: 56),
web (`zoned-time`, `site/content`: 9).

## Not ported

| Id         | Why                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| TW-CMS-053 | dead code in Reference (guidebook prototype script), not ported on purpose                                                               |
| TW-CMS-027 | Reference's upload endpoint is unreachable (no image-typed field, no UI control); needs SET object storage, which is not built. Blocked. |

## Deliberate deviations (intended)

| Behaviour                    | Reference                                                            | Ours                                                                                   |
| ---------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Per-locale override of text  | published text reverted colours and links per locale              | one language, published text applies to every visitor                                  |
| Reset to default             | deleted live rows at once                                         | writes a draft tombstone, reversible with Discard, live after Publish                  |
| Reorder request (023)        | request shape fails server validation (probable bug)              | JSON body; order saved, heroes pinned, foreign slugs dropped                           |
| Blog view counter            | read-modify-write, refreshes `updated_at` (moves sitemap lastmod) | atomic `cms_record_blog_view()`, `updated_at` untouched                                |
| Guidebook vote (049)         | refreshes article "updated"                                       | does not; votes are per workspace                                                      |
| Guidebook seed (050)         | re-seed overwrites edited seeded slugs                            | seeds only an empty help centre, `ON CONFLICT DO NOTHING`                              |
| Guidebook search             | `%` and `_` act as wildcards                                      | escaped                                                                                |
| Default marketing copy       | invented stats, logos, testimonials                               | neutral placeholder copy                                                               |
| Legal templates (036)        | Reference text                                                       | original generic text, counsel review needed                                           |
| Homepage title               | brand                                                             | SEO title from platform settings, else brand name                                      |
| Permissions                  | platform admin + IP allowlist                                     | `OperatorGuard`; every operator role reads, `super_admin` writes                       |
| Audit                        | partial                                                           | `security_events` row in the same transaction for every operator write                 |
| Host routing (001)           | storefront / white-label host resolution                          | blocked (WSP/STORE not built): `/` serves the marketing page for every host            |
| Site identity, SEO, footer   | settings domain                                                   | root layout reads platform settings (SET built); CMS keeps `site.*`/`footer.*` keys    |
| Pricing FAQ admin (037, 038) | CMS screen                                                        | screen lives in the PLAN zone (`/admin/pricing-faqs`); CMS public site reads the table |
