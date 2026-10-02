# Parity evidence: chatbot widget (WGT)

WaDesk 1.7.0 reference (http://127.0.0.1:8000) vs this branch. API reference: [docs/api/chatbot-widget.md](../../api/chatbot-widget.md).
Run artifacts (screenshots, probe logs) live outside the repo.

## Evidence

- Reference probes (Playwright, real app use, test data removed afterwards): save validation, slug and token rules, config, message, history,
  CORS and allow-list, 404 shapes, rotate, delete, the embed script and chat page, and a cross-origin embed on a stand-in customer site.
- Same cross-origin embed run on ours: launcher box (56x56 at the same corner), panel (380x560), header text, opening bubble, disabled Send until the intake
  "Continue", WhatsApp link `https://wa.me/919876543210?text=Hi%2C+I%27d+like+to+know+more.`, bubbles after a send: identical to the reference. Screenshots of the
  panel match visually.
- Builder (4 steps, live preview) and list compared by screenshot against the reference; same layout, copy and controls.
- Automated: `apps/api/test/unit/chatbot-widget` (40), `apps/api/test/e2e/chatbot-widget` (112, real Postgres + Redis, local AI vendor stub),
  `apps/api/test/integration/chatbot-widget` (9: RLS forced, cross-tenant insert/update/delete refused, composite FK, token lookup function, checks),
  `apps/web/src/features/chatbot-widget/lib/models.test.ts` (19), browser run `apps/web/e2e/chatbot-widget/builder-and-list.e2e.mjs`.

## Features

| Id             | Status         | Note                                                                                                                                                               |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WD-WGT-001     | done           | List, four cards, status views (now working), client-side search, row actions. Cursor "Load more" instead of page links.                                           |
| WD-WGT-002     | done           | Four-step builder, per-step gates, preview, Save draft, Launch. No unsaved-changes guard and no URL rewrite (as WaDesk).                                           |
| WD-WGT-003     | done           | Engine tiles, agent picker, country picker + digits (dial code `+cc`), pre-typed message. Own picker instead of intl-tel-input.                                    |
| WD-WGT-004/5   | done           | Styling, opening line, send button, intake gate with the "show once" rule.                                                                                         |
| WD-WGT-006     | done           | See differences.                                                                                                                                                   |
| WD-WGT-007     | done           | Snippet reveal after Launch, copy, standalone preview; list copy with clipboard fallback dialog.                                                                   |
| WD-WGT-008-018 | done           | Loader, chat page, config, visitor, repaint, WhatsApp link, message, thread and contact, AI reply, takeover, polling.                                              |
| WD-WGT-020     | done           | Origin allow-list on config, message and history.                                                                                                                  |
| WD-WGT-021     | partial        | API and enforcement done; the builder has no control for it (as WaDesk, whose docs promise one).                                                                   |
| WD-WGT-022     | done           | Token shape, throttles, no CSRF, framable page.                                                                                                                    |
| WD-WGT-023-026 | done           | Rotate, duplicate, delete, pause/resume.                                                                                                                           |
| WD-WGT-027     | blocked (part) | Permission keys done; the `access_chatbot_widgets` plan flag is not in the plan catalogue, so the gate is an open shim. The widget limit is unenforced, as WaDesk. |
| WD-WGT-028     | partial        | Sidebar item. More tile, quick-access list and command palette belong to the shell.                                                                                |
| WD-WGT-019     | blocked        | The widget side is done and tested (thread, contact, polling contract). Team Inbox screens, the inbox reply path and the mobile list are TIB1/MOB.                 |
| WD-WGT-029     | done           | FK cascades; the tenant purge job belongs to WSP.                                                                                                                  |
| WD-WGT-030     | wontfix        | Greenfield: nothing to backfill.                                                                                                                                   |

## Intended differences (each with its reason)

1. **Human takeover (WD-WGT-017): fixed.** Verified on the reference: the bot answers the first message only (reply `null` from the second on, with no agent involved), because
   the takeover check compares an encrypted column with plain text. Here a thread goes quiet only after an outbound line not written by the widget's own bot.
2. **CORS allow-list (WD-WGT-020): the widget's own host is always allowed.** Verified on the reference: with a non-empty list the chat page's own POST is refused (403).
3. **Save with an unknown id is 404**, not a new widget; deleting then re-creating a name no longer fails on the slug (hard delete).
4. **Opening line is a message of the thread** (agents see it, a reload repaints it) instead of a legacy-table row nobody reads.
5. **Transcript is the newest 200 messages**, not the oldest.
6. **History poll respects pause**; an unknown visitor on the poll gets an empty list and no new row (WaDesk created a row per poll).
7. **Hard delete**: a deleted widget's visitors go with it (WaDesk's visitor stat kept counting them). Conversations and contacts stay.
8. **Hardening**: colours must be colour tokens (WaDesk stored any 16 characters); script values are JSON-escaped; background image URLs are encoded properly
   (WaDesk's `encodeURIComponent` left quotes and brackets); config is throttled (120/min); throttle counters are per widget and address.
9. **Status pause/resume** exists as an API and a row action (WaDesk had the column and the docs but no control), which also makes the status views work.
10. **Errors are visible in the chat page**: a refused message shows "Sorry, that didn't go through" and a failed config shows a notice (WaDesk showed nothing).
11. `allowedDomains` with a blank entry is accepted and the blank dropped (the reference answered 422 for a blank; the inventory's acceptance criterion says it is dropped).
12. Cookie and visitor-storage key are built from the widget uuid, not the token, so rotating the token keeps returning visitors.
13. Audit rows and outbox events on every write (WaDesk wrote none). Embed addresses use the configured public base (`WIDGET_PUBLIC_BASE_URL` / API host), not the browser origin.
14. Admin API errors are problem+json; the public API keeps WaDesk's `{ok,error}` and Laravel-style 422 shapes and sentences.

## NOT verified

- **Real AI provider calls.** No provider key is available; the vendor adapter is tested against a local stub (prompt, token cap, fallback, error paths). Real OpenAI/Anthropic/Gemini responses were not seen. BYOK/platform key resolution and metering belong to AIADM (keys come from `WGT_AI_*` env).
- **Team Inbox display and agent reply path.** There is no inbox in this app yet; agent replies are simulated by inserting an outbound `inbox_messages` row. Real inbox reply delivery, the "Web widget" badge and push/translation observers are untested.
- **Throttle on the reference**: 64 consecutive message posts were not limited there, so the 60/min figure is the spec, not an observed behaviour.
- **Paused widget on the reference**: it cannot be set without editing the reference database, so the paused behaviour is checked against the spec only.
- **Plan gate and role gate behaviours** (paywall overlay, 403/redirect by role) against the reference: not run; plan flag is a shim.
- **Playwright twin harness** (`wadesk-playwright-parity`) was not run; comparisons above were done with direct scripts. No stamp recorded.
- **Dark mode, RTL, Arabic copy, mobile widths** of the admin screens; **file/media storage** (none used: launcher and background images are URLs); **MinIO** unavailable.
- **Cross-origin preflight per widget** (OPTIONS from an allowed customer origin): answered by the global CORS middleware, not per widget; not exercised.
- The reference still holds a few visitor/conversation rows created by the probes (the widgets and the assistant were deleted).
