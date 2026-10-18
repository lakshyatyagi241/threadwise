-- con: CHECK constraints for status/kind columns whose value set is closed and has exactly one writer (QA task 47, con-enum).
-- Why this migration exists: these columns were free text, so a typo or a new code path could store a status no reader knows. Only the
-- columns where the full set could be proven from the code are constrained here; each set below is the union of every value the single
-- owning repository or contract writes:
--   storefront_cart_recoveries.status  active -> recovered | sent                (storefront-builder/recovery/cart-recovery.repository.ts)
--   shopify_/woocommerce_stock_waitlist.status  waiting -> notified               (shopify-woocommerce/stock.repository.ts)
--   wa_pending_orders.status           pending -> confirmed | cancelled           (flow-runtime-engine/.../ai/ordering.service.ts)
--   ai_training_sources.kind / status  AIAG_SOURCE_KINDS / AIAG_SOURCE_STATUSES   (packages/contracts/src/ai-agents-training/sources.ts)
-- NOT VALID: new and updated rows are checked at once; rows already stored are not scanned, so this cannot fail on old data or hold a long lock.
-- Run `ALTER TABLE <t> VALIDATE CONSTRAINT <name>` later, once the table is known clean.
ALTER TABLE storefront_cart_recoveries ADD CONSTRAINT chk_cart_recoveries_status CHECK (status IN ('active', 'recovered', 'sent')) NOT VALID;
ALTER TABLE shopify_stock_waitlist ADD CONSTRAINT chk_shopify_waitlist_status CHECK (status IN ('waiting', 'notified')) NOT VALID;
ALTER TABLE woocommerce_stock_waitlist ADD CONSTRAINT chk_woocommerce_waitlist_status CHECK (status IN ('waiting', 'notified')) NOT VALID;
ALTER TABLE wa_pending_orders ADD CONSTRAINT chk_wa_pending_orders_status CHECK (status IN ('pending', 'confirmed', 'cancelled')) NOT VALID;
ALTER TABLE ai_training_sources ADD CONSTRAINT chk_ai_training_sources_kind CHECK (kind IN ('url', 'text', 'qa', 'file')) NOT VALID;
ALTER TABLE ai_training_sources ADD CONSTRAINT chk_ai_training_sources_status CHECK (status IN ('ready', 'processing', 'failed')) NOT VALID;
