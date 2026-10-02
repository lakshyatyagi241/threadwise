-- cat: value checks for the catalog tables.
-- Why this migration exists: the WaDesk schema migration (20261001105000) copied MySQL's loose columns, so the database accepted a
-- catalog provider nobody supports, a review rated 17, a stock hold of -3 pieces or a product with a negative price; only the
-- application stood in the way. The values below are the ones WaDesk's code writes and the catalog module reads (contracts
-- `catalog-products`). Each constraint is NOT VALID: it is enforced for every new and changed row, and an existing row that
-- predates it is not re-checked (a development database may hold odd rows; nothing here rewrites or deletes data).

ALTER TABLE wa_catalogs
  ADD CONSTRAINT chk_wa_catalogs_provider CHECK (provider IN ('meta_cloud', 'dialog_360')) NOT VALID;

ALTER TABLE wa_products
  ADD CONSTRAINT chk_wa_products_status CHECK (status IN ('active', 'draft', 'archived')) NOT VALID,
  ADD CONSTRAINT chk_wa_products_price CHECK (price_minor >= 0 AND (compare_price_minor IS NULL OR compare_price_minor >= 0)) NOT VALID,
  ADD CONSTRAINT chk_wa_products_stock CHECK ((stock_qty IS NULL OR stock_qty >= 0) AND reserved_qty >= 0) NOT VALID,
  ADD CONSTRAINT chk_wa_products_meta_sync_status CHECK (meta_sync_status IS NULL OR meta_sync_status IN ('pending', 'synced', 'failed', 'error')) NOT VALID;

ALTER TABLE wa_product_reviews
  ADD CONSTRAINT chk_wa_product_reviews_rating CHECK (rating BETWEEN 1 AND 5) NOT VALID,
  ADD CONSTRAINT chk_wa_product_reviews_status CHECK (status IN ('pending', 'approved', 'rejected')) NOT VALID;

ALTER TABLE wa_stock_reservations
  ADD CONSTRAINT chk_wa_stock_reservations_qty CHECK (qty > 0) NOT VALID,
  ADD CONSTRAINT chk_wa_stock_reservations_status CHECK (status IN ('held', 'committed', 'released')) NOT VALID;
