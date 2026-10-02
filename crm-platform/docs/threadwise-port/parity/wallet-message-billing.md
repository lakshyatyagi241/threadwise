# Parity: wallet-message-billing

Evidence: unit (63), schema integration (22) and API end-to-end (68) tests under `apps/api/test/*/wallet-message-billing`, run against the real migrated schema. **Not run:** the side-by-side Playwright twin against the running Reference reference (not started in this session), live Meta/Twilio/Baileys delivery, a real gateway payment, a live Meta pricing endpoint, the websocket balance push. The bundled Meta rate card is INDICATIVE (approximate, not copied from Meta); verify before relying on margins.

## Intended differences (each is a documented fix or forced by our architecture; owner approval pending)
1. **Money model.** Balances and prices are money (hundredths), one wallet per **workspace**, not credits per user. The `credits_per_currency_minor` setting, the drifting `wallet_currency_minor` mirror and the currency/credit paired ledger rows are not ported (inventory TW-002 port note, open question 1/6).
2. **Signed ledger.** Spends are negative with an explicit direction; statement, CSV and wallet tab classify by direction (fixes the "charges shown as money in" bug). The Top-ups filter lists top-ups. "Earned" counts earnings only.
3. **Immutable, attributable.** Ledger entries cannot be edited or deleted; manual adjustments require a note and the operator.
4. **Idempotency by key table**, wallet row lock per workspace (quota counted under the lock; Reference could over-grant free messages).
5. **Rate card:** Meta cost keeps 6 decimals; rate save no longer rewrites the two master switches; per-row server errors; explicit add row; new rows from import/sync take the price those messages already had (Reference created them at 0); import and sync preview first; starter card stored in the grid unit (12.00 not 12).
6. **Launch gate** compares the balance with the estimate (setting, default 100%; 0 restores Reference's "block only when empty"). Fail-open on lookup errors kept.
7. **Low-balance alert** re-arms on a top-up and notifies the workspace Owners.
8. **Settlement is an event consumer** (worker), never inline in a webhook; billable statuses decided once.
9. **Legacy send-time overflow billing (TW-014)** not ported as a mode; **self-confirm checkout (TW-018)** deliberately absent (free-credits hole); **credit-package purchase (TW-017)** not ported (retired in Reference).
10. Limits added: top-up/adjust maximum 10,000,000.00, CSV export 50,000 rows.

11. **Margin pricing** replaces typing a customer price next to Meta's cost (Reference): price = Meta cost x (1 + margin %) per country and category, defaults per plan, override per workspace with a reason. Typed prices remain as the fallback and as the `fixed` mode. Charges settle in hundredths, so a sub-cent Meta cost is billed as 0.01.
12. **Credit packages (TW-019)** are a catalogue with a bonus view (wallet credit vs price); the bundle checkout stays retired. **Mobile/extension (TW-025..029)** are served by `GET /wallet/snapshot`, the ledger endpoint and the PAYGW top-up orders (webhook-first confirmation instead of a client-claimed confirm).
13. **Live balance push** uses the existing realtime channel (`wallet.updated`).

## Not built / deferred (tracked in the tracker)
The scheduled-message poller filter (TW-013 rule 6) waits for the scheduled-queue domain (SCHED does not exist yet). The templates price panel waits for the templates screen (TPL). The Meta rate card in the repo is approximate and could not be checked against Meta from this environment (outbound access to Meta is blocked): load Meta's official CSV with `rates/import` before relying on margins. TW-033 docs-only items are not features.
