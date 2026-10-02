# Parity: wallet-message-billing

Evidence: unit (63), schema integration (22) and API end-to-end (68) tests under `apps/api/test/*/wallet-message-billing`, run against the real migrated schema. **Not run:** the side-by-side Playwright twin against the running WaDesk reference (not started in this session), live Meta/Twilio/Baileys delivery, a real gateway payment, a live Meta pricing endpoint, the websocket balance push. The bundled Meta rate card is INDICATIVE (approximate, not copied from Meta); verify before relying on margins.

## Intended differences (each is a documented fix or forced by our architecture; owner approval pending)
1. **Money model.** Balances and prices are money (hundredths), one wallet per **workspace**, not credits per user. The `credits_per_currency_minor` setting, the drifting `wallet_currency_minor` mirror and the currency/credit paired ledger rows are not ported (inventory WD-002 port note, open question 1/6).
2. **Signed ledger.** Spends are negative with an explicit direction; statement, CSV and wallet tab classify by direction (fixes the "charges shown as money in" bug). The Top-ups filter lists top-ups. "Earned" counts earnings only.
3. **Immutable, attributable.** Ledger entries cannot be edited or deleted; manual adjustments require a note and the operator.
4. **Idempotency by key table**, wallet row lock per workspace (quota counted under the lock; WaDesk could over-grant free messages).
5. **Rate card:** Meta cost keeps 6 decimals; rate save no longer rewrites the two master switches; per-row server errors; explicit add row; new rows from import/sync take the price those messages already had (WaDesk created them at 0); import and sync preview first; starter card stored in the grid unit (12.00 not 12).
6. **Launch gate** compares the balance with the estimate (setting, default 100%; 0 restores WaDesk's "block only when empty"). Fail-open on lookup errors kept.
7. **Low-balance alert** re-arms on a top-up and notifies the workspace Owners.
8. **Settlement is an event consumer** (worker), never inline in a webhook; billable statuses decided once.
9. **Legacy send-time overflow billing (WD-014)** not ported as a mode; **self-confirm checkout (WD-018)** deliberately absent (free-credits hole); **credit-package purchase (WD-017)** not ported (retired in WaDesk).
10. Limits added: top-up/adjust maximum 10,000,000.00, CSV export 50,000 rows.

## Not built / deferred (tracked in the tracker)
WD-019 admin credit packages CRUD (table owned by CPN, UI retired in WaDesk), WD-025..029 mobile/extension surfaces (MOB/EXT), WD-033 docs-only items (not features).
