-- wallet: every workspace is billed in its own currency (USD, INR, ...)
-- Why this migration exists: the wallet engine assumed ONE platform currency. A workspace billed in INR needs its own INR wallet,
-- priced from Meta's INR card, and the books (ledger, usage charges, the reseller P&L) must say which currency each row is in.
--   * wallet_transactions.unit: the currency of the wallet the entry moved. A workspace can hold a wallet per currency
--     (wallets is already unique on (org_id, unit)), so the ledger can no longer be read by org alone. Existing rows are stamped
--     with their org's wallet unit (until now an org had exactly one wallet).
--   * usage_charges.currency: the currency a message was priced and charged in, so the P&L can total each currency on its own
--     instead of adding rupees to dollars. NULL means the platform currency (every row written before this migration). Not
--     back-filled: the table is a large partitioned stream and NULL already reads correctly.
--   * orders.wallet_unit: the wallet a top-up order credits, fixed when the order is placed so a currency change between placing
--     and paying cannot move the money to a different wallet. NULL means the platform currency (older orders).

ALTER TABLE wallet_transactions ADD COLUMN unit text;
UPDATE wallet_transactions t
   SET unit = (SELECT w.unit FROM wallets w WHERE w.org_id = t.org_id ORDER BY w.id LIMIT 1)
 WHERE t.unit IS NULL;
ALTER TABLE wallet_transactions
  ADD CONSTRAINT chk_wallet_transactions_unit CHECK (unit IS NULL OR unit ~ '^[A-Z]{3}$');
CREATE INDEX idx_wallet_transactions_org_unit_created
  ON wallet_transactions (org_id, unit, created_at DESC, id DESC);

ALTER TABLE usage_charges ADD COLUMN currency text;
ALTER TABLE usage_charges
  ADD CONSTRAINT chk_usage_charges_currency CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');

ALTER TABLE orders ADD COLUMN wallet_unit text;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_wallet_unit CHECK (wallet_unit IS NULL OR wallet_unit ~ '^[A-Z]{3}$');
