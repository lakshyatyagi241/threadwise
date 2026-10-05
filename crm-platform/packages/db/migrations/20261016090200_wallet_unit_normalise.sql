-- wallet: wallets written by the payment fulfilment's stand-in are converted to the money model.
-- Why this migration exists: before the wallet engine existed, a paid top-up was posted to a wallet of unit 'credits' whose
-- balance and ledger amounts held the paid amount in HUNDREDTHS (a 10.00 top-up was stored as 1000). The engine keeps one wallet per
-- workspace in the platform currency, in whole units (10.00), which is also what the reseller P&L reads. Wallets of unit 'credits'
-- are converted once: balance and every ledger amount divide by 100 and the unit becomes the platform currency (the saved
-- `general` settings group, else USD). A fresh database has none, so this changes nothing there.
-- The ledger is immutable by trigger; this migration lifts that for its own statements only.

ALTER TABLE wallet_transactions DISABLE TRIGGER trg_wallet_transactions_immutable;

UPDATE wallet_transactions t
SET amount = t.amount / 100, balance_after = t.balance_after / 100
FROM wallets w
WHERE w.org_id = t.org_id AND w.unit = 'credits';

UPDATE wallets
SET balance = balance / 100,
    reserved = reserved / 100,
    unit = COALESCE(
      (SELECT upper(value ->> 'defaultCurrency') FROM platform_settings WHERE key = 'set.general' AND value ->> 'defaultCurrency' <> ''),
      'USD')
WHERE unit = 'credits';

ALTER TABLE wallet_transactions ENABLE TRIGGER trg_wallet_transactions_immutable;
