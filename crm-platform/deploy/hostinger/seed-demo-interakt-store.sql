-- Edge-case demo data for the "demo-interakt" workspace: the store (storefronts, products, sets, coupons, orders, reviews, cart
-- recovery), invoicing (settings, sales orders, invoices in every state, payments and refunds, credit notes, attempts, recurring)
-- and forms (web forms, versions, submissions, payments, funnel events; WhatsApp forms and their submissions).
--
--   docker compose --env-file .env exec -T postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -v ON_ERROR_STOP=1 -v commit=1' < seed-demo-interakt-store.sql
--
-- Runs as the database owner (bypasses RLS; every row names org_id explicitly) in ONE transaction. Without `-v commit=1` it rolls back
-- (a dry run that still proves every constraint and trigger accepts the data). Refuses to run twice: it stops when the marker rows exist.
-- Every row it creates is recognisable: SKUs, codes, slugs, references and numbers start with SEED / seed. Money is in minor units.
-- The payment ledger and issued invoices are frozen by triggers on purpose, so the way to undo a committed seed is to restore the
-- pre-seed dump (see docs/runbooks/backup-restore.md), not to delete rows.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = 15 AND slug = 'demo-interakt') THEN
    RAISE EXCEPTION 'org 15 is not demo-interakt';
  END IF;
  IF EXISTS (SELECT 1 FROM wa_products WHERE org_id = 15 AND sku LIKE 'SEED-%') THEN
    RAISE EXCEPTION 'already seeded (SEED- products exist); restore the pre-seed dump to run again';
  END IF;
END $$;

CREATE TEMP TABLE k (key text PRIMARY KEY, id bigint NOT NULL);
CREATE FUNCTION pg_temp.k(text) RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT id FROM k WHERE key = $1 $$;

-- =====================================================================================================================================
-- 1. CRM: contacts, a company and tax rates the store and invoices point at
-- =====================================================================================================================================
INSERT INTO k VALUES ('c:owner', 63), ('c:agent', 66), ('c:16', 16), ('c:18', 18), ('c:aarav', 19), ('c:priya', 20);

INSERT INTO contacts (org_id, name, first_name, last_name, email, phone, normalized_phone, source) VALUES
  (15, 'Meera Nair',                 'Meera',  'Nair',       'meera.nair@seed.example',    '+919811100001', '+919811100001', 'seed'),
  (15, 'Rohan (phone only)',         'Rohan',  NULL,         NULL,                         '+919811100002', '+919811100002', 'seed'),
  (15, 'Zoë Müller-Åström 渡辺',      'Zoë',    'Müller-Åström', 'zoe.muller@seed.example', '+4915112345678', '+4915112345678', 'seed'),
  (15, 'Email Only Customer',        'Email',  'Only',       'email.only@seed.example',    NULL, NULL, 'seed'),
  (15, 'Opted Out Buyer',            'Opted',  'Out',        'optout@seed.example',        '+919811100003', '+919811100003', 'seed');
INSERT INTO k SELECT 'c:' || split_part(email::text, '@', 1), id FROM contacts WHERE org_id = 15 AND source = 'seed' AND email IS NOT NULL;
INSERT INTO k SELECT 'c:rohan', id FROM contacts WHERE org_id = 15 AND source = 'seed' AND name = 'Rohan (phone only)';
UPDATE contacts SET is_unsubscribed = true, unsubscribed_at = now() - interval '9 days', whatsapp_subscription_status = 'unsubscribed'
 WHERE org_id = 15 AND source = 'seed' AND email::text = 'optout@seed.example';

INSERT INTO companies (org_id, name, domain, email, phone, address, industry)
VALUES (15, 'SEED Textiles Pvt Ltd', 'seed-textiles.example', 'accounts@seed-textiles.example', '+912227000000', 'Plot 14, MIDC Andheri East, Mumbai 400093', 'Retail')
RETURNING id \gset co_
INSERT INTO k VALUES ('co:textiles', :co_id);

INSERT INTO tax_rates (org_id, name, rate_percent, inclusive, is_default, is_active, tax_type, country, description) VALUES
  (15, 'SEED GST 18%',            18, false, true,  true,  'gst', 'IN', 'Standard goods and services'),
  (15, 'SEED GST 5% (inclusive)',  5, true,  false, true,  'gst', 'IN', 'Priced with tax included'),
  (15, 'SEED GST 0% (exempt)',     0, false, false, true,  'gst', 'IN', 'Exempt supplies'),
  (15, 'SEED Old VAT 12.5% (retired)', 12.5, false, false, false, 'vat', 'IN', 'Inactive: must not be offered on new documents');
INSERT INTO k SELECT 'tax:' || CASE rate_percent WHEN 18 THEN '18' WHEN 5 THEN '5i' WHEN 0 THEN '0' ELSE 'old' END, id
  FROM tax_rates WHERE org_id = 15 AND name LIKE 'SEED %';

-- =====================================================================================================================================
-- 2. STORE: storefronts
-- =====================================================================================================================================
UPDATE wa_storefronts SET
  shop_name = 'Interakt Demo Store', theme_key = 'aurora', enabled = true, currency_code = 'INR',
  settings_json = '{"logo_url":null,"brand_color":"#0f766e","hero_text":"Handpicked goods, shipped across India","footer_text":"Free shipping above Rs 999","cart_recovery_enabled":true,"cart_recovery_delay_min":30,"cart_recovery_message":"You left something in your cart!","top_strip":"SEED edge-case demo","hero_sub":"Cash on delivery available"}'::jsonb,
  shipping_json = '{"flat_minor":4900,"free_above_minor":99900}'::jsonb
 WHERE org_id = 15 AND id = 4;

INSERT INTO wa_storefronts (org_id, shop_name, slug, theme_key, enabled, currency_code, custom_domain, custom_domain_verified, settings_json, shipping_json, payment_provider) VALUES
  (15, 'SEED Export Outlet (USD, disabled)', 'seed-export-outlet', 'minimal', false, 'USD', 'shop.seed-export.example', false,
   '{"cart_recovery_enabled":false,"cart_recovery_delay_min":0}'::jsonb, '{"flat_minor":0,"free_above_minor":0}'::jsonb, 'stripe'),
  (15, 'SEED Verified Domain Shop', 'seed-verified-shop', 'aurora', true, 'INR', 'verified.seed-shop.example', true,
   '{"brand_color":"not-a-color","cart_recovery_enabled":"yes","cart_recovery_delay_min":-5}'::jsonb, NULL, 'razorpay');
INSERT INTO k VALUES ('sf:main', 4);
INSERT INTO k SELECT 'sf:export', id FROM wa_storefronts WHERE org_id = 15 AND slug = 'seed-export-outlet';
INSERT INTO k SELECT 'sf:verified', id FROM wa_storefronts WHERE org_id = 15 AND slug = 'seed-verified-shop';

-- daily views: a month of traffic with gaps and a spike; the disabled shop has none
INSERT INTO wa_storefront_views (org_id, storefront_id, day, views)
SELECT 15, 4, (current_date - g), CASE WHEN g % 7 = 3 THEN 0 WHEN g = 5 THEN 1840 ELSE 20 + (g * 37) % 90 END
  FROM generate_series(0, 44) g WHERE g <> 4
ON CONFLICT (org_id, storefront_id, day) DO UPDATE SET views = EXCLUDED.views;
INSERT INTO wa_storefront_views (org_id, storefront_id, day, views)
SELECT 15, pg_temp.k('sf:verified'), (current_date - g), 3 + g FROM generate_series(0, 6) g;

-- =====================================================================================================================================
-- 3. STORE: products (stock, price, status, sync and text edge cases)
-- =====================================================================================================================================
INSERT INTO wa_products (org_id, storefront_id, sku, name, slug, description, body_html, price_minor, compare_price_minor, weight_grams, category,
                         tags_json, aliases_json, status, availability, condition, brand, product_url, currency_code, image_url, gallery_json,
                         in_stock, stock_qty, reserved_qty, sort_order, meta_retailer_id, meta_sync_status, meta_synced_at, meta_last_error,
                         shopify_product_id, woo_product_id, user_id)
VALUES
 (15, 4, 'SEED-TEE-001', 'Classic Cotton Tee', 'seed-classic-cotton-tee', 'Everyday 100% cotton tee', '<p>Soft, breathable.</p>', 49900, 69900, 180, 'Apparel',
  '["tee","cotton","bestseller"]', '["t shirt","tshirt"]', 'active', 'in stock', 'new', 'SeedWear', 'https://seed.example/tee', 'INR', 'https://picsum.photos/seed/tee/600', '["https://picsum.photos/seed/tee2/600"]',
  true, 120, 4, 1, 'SEED-TEE-001', 'synced', now() - interval '2 days', NULL, NULL, NULL, 63),
 (15, 4, 'SEED-HOOD-002', 'Hoodie, Heavyweight', 'seed-hoodie-heavyweight', NULL, NULL, 189900, 189900, 650, 'Apparel',
  '["hoodie"]', NULL, 'active', 'in stock', 'new', 'SeedWear', NULL, 'INR', NULL, NULL,
  true, 8, 8, 2, 'SEED-HOOD-002', 'pending', NULL, NULL, NULL, NULL, 63),
 (15, 4, 'SEED-SOCK-003', 'Crew Socks 3-pack (out of stock)', 'seed-crew-socks', 'Sold out until the next batch', NULL, 29900, 39900, 120, 'Apparel',
  NULL, NULL, 'active', 'out of stock', 'new', 'SeedWear', NULL, 'INR', 'https://picsum.photos/seed/socks/600', NULL,
  false, 0, 0, 3, 'SEED-SOCK-003', 'synced', now() - interval '12 days', NULL, NULL, NULL, 63),
 (15, 4, 'SEED-CAP-004', 'Dad Cap (stock not tracked)', 'seed-dad-cap', 'Stock quantity left blank on purpose', NULL, 34900, NULL, 90, 'Accessories',
  '["cap"]', NULL, 'active', 'available for order', 'new', NULL, NULL, 'INR', NULL, NULL,
  true, NULL, 0, 4, NULL, NULL, NULL, NULL, NULL, NULL, 63),
 (15, 4, 'SEED-FREE-005', 'Free Sticker Sheet (price zero)', 'seed-free-sticker-sheet', 'A giveaway: price 0', NULL, 0, 9900, 10, 'Accessories',
  '["free"]', NULL, 'active', 'in stock', 'new', NULL, NULL, 'INR', NULL, NULL,
  true, 5000, 0, 5, 'SEED-FREE-005', 'failed', NULL, 'Meta rejected the item: price must be greater than 0', NULL, NULL, 63),
 (15, 4, 'SEED-LUX-006', 'Limited Edition Watch (very high price)', 'seed-limited-watch', 'Serialized, 25 pieces', '<p>Swiss movement</p>', 9999900, 12999900, 200, 'Watches',
  '["luxury","limited"]', NULL, 'active', 'in stock', 'new', 'SeedTime', 'https://seed.example/watch', 'INR', 'https://picsum.photos/seed/watch/600', NULL,
  true, 25, 1, 6, 'SEED-LUX-006', 'synced', now() - interval '1 day', NULL, NULL, NULL, 63),
 (15, 4, 'SEED-DRAFT-007', 'Unreleased Jacket (draft)', 'seed-unreleased-jacket', 'Not visible on the storefront', NULL, 349900, NULL, 900, 'Apparel',
  NULL, NULL, 'draft', 'in stock', 'new', NULL, NULL, 'INR', NULL, NULL,
  true, 40, 0, 7, NULL, NULL, NULL, NULL, NULL, NULL, 63),
 (15, 4, 'SEED-ARCH-008', 'Discontinued Scarf (archived)', 'seed-discontinued-scarf', NULL, NULL, 59900, 99900, 150, 'Accessories',
  NULL, NULL, 'archived', 'discontinued', 'new', NULL, NULL, 'INR', NULL, NULL,
  false, 0, 0, 8, 'SEED-ARCH-008', 'error', NULL, 'Item not found in catalog', NULL, NULL, 63),
 (15, 4, 'SEED-REF-009', 'Refurbished Speaker', 'seed-refurbished-speaker', 'Grade A refurbished', NULL, 249900, 399900, 800, 'Electronics',
  '["audio"]', NULL, 'active', 'in stock', 'refurbished', 'SeedAudio', NULL, 'INR', 'https://picsum.photos/seed/speaker/600', NULL,
  true, 3, 3, 9, 'SEED-REF-009', 'synced', now() - interval '30 days', NULL, NULL, NULL, 63),
 (15, 4, 'SEED-USED-010', 'Pre-owned Camera', 'seed-preowned-camera', 'Used, light wear', NULL, 1499900, NULL, 650, 'Electronics',
  NULL, NULL, 'active', 'in stock', 'used', NULL, NULL, 'INR', NULL, NULL,
  true, 1, 1, 10, NULL, NULL, NULL, NULL, NULL, NULL, 63),
 (15, 4, 'SEED-UNI-011', 'चाय मसाला · Masala Chai 🍵 (unicode name)', 'seed-masala-chai', repeat('Aromatic blend. ', 120), '<ul><li>Cardamom</li><li>Ginger</li></ul>', 24900, NULL, 250, 'Grocery',
  '["tea","चाय"]', '["chai","masala tea"]', 'active', 'in stock', 'new', 'Seed Tea Co', NULL, 'INR', 'https://picsum.photos/seed/chai/600', NULL,
  true, 300, 12, 11, 'SEED-UNI-011', 'synced', now() - interval '3 days', NULL, NULL, NULL, 63),
 (15, 4, 'SEED-SHOP-012', 'Imported From Shopify', 'seed-imported-shopify', 'Came from the Shopify sync', NULL, 79900, NULL, 300, 'Imported',
  NULL, NULL, 'active', 'in stock', 'new', NULL, NULL, 'INR', NULL, NULL,
  true, 15, 0, 12, NULL, NULL, NULL, NULL, '8123456789012', NULL, 63),
 (15, 4, 'SEED-WOO-013', 'Imported From WooCommerce', 'seed-imported-woo', 'Came from the WooCommerce sync', NULL, 64900, NULL, 300, 'Imported',
  NULL, NULL, 'active', 'in stock', 'new', NULL, NULL, 'INR', NULL, NULL,
  true, 22, 0, 13, NULL, NULL, NULL, NULL, NULL, '4456', 63),
 (15, 4, 'SEED-LOW-014', 'Low Stock Notebook (reserved = stock)', 'seed-low-stock-notebook', NULL, NULL, 19900, 24900, 220, 'Stationery',
  '["paper"]', NULL, 'active', 'in stock', 'new', NULL, NULL, 'INR', NULL, NULL,
  true, 2, 2, 14, 'SEED-LOW-014', 'pending', NULL, NULL, NULL, NULL, 63),
 (15, NULL, 'SEED-NOSHOP-015', 'Not Attached To Any Storefront', 'seed-no-storefront', 'storefront_id is null', NULL, 99900, NULL, 400, NULL,
  NULL, NULL, 'active', 'in stock', 'new', NULL, NULL, 'INR', NULL, NULL,
  true, 10, 0, 15, NULL, NULL, NULL, NULL, NULL, NULL, 63);

INSERT INTO wa_products (org_id, storefront_id, sku, name, slug, description, price_minor, compare_price_minor, weight_grams, category, status, availability, condition,
                         currency_code, image_url, in_stock, stock_qty, reserved_qty, sort_order, user_id)
SELECT 15, pg_temp.k('sf:export'), 'SEED-USD-' || lpad(g::text, 3, '0'), 'Export Item ' || g, 'seed-export-item-' || g, 'USD priced', 1999 * g, NULL, 300, 'Export', 'active', 'in stock', 'new',
       'USD', 'https://picsum.photos/seed/exp' || g || '/600', true, 50, 0, g, 63
  FROM generate_series(1, 3) g;

INSERT INTO k SELECT 'p:' || split_part(sku, '-', 2) || split_part(sku, '-', 3), id FROM wa_products WHERE org_id = 15 AND sku LIKE 'SEED-%';
-- short keys: p:TEE001, p:HOOD002, p:SOCK003, p:CAP004, p:FREE005, p:LUX006, p:DRAFT007, p:ARCH008, p:REF009, p:USED010, p:UNI011, p:SHOP012, p:WOO013, p:LOW014, p:NOSHOP015, p:USD001..3

INSERT INTO wa_product_sets (org_id, name, slug, description, product_ids, is_active, meta_set_id, user_id) VALUES
  (15, 'SEED Bestsellers',        'seed-bestsellers', 'Top sellers', jsonb_build_array(pg_temp.k('p:TEE001'), pg_temp.k('p:UNI011'), pg_temp.k('p:HOOD002')), true,  'meta-set-1001', 63),
  (15, 'SEED Empty Set',          'seed-empty-set',   'No products yet', '[]'::jsonb, true, NULL, 63),
  (15, 'SEED Inactive With Gone Product', 'seed-inactive-set', 'References a product id that no longer exists', jsonb_build_array(pg_temp.k('p:CAP004'), 999999999), false, NULL, 63),
  (15, 'SEED No Slug No Description', NULL, NULL, NULL, true, NULL, NULL);

-- coupons: every rule a coupon can have
INSERT INTO wa_coupons (org_id, storefront_id, code, type, amount, min_subtotal_minor, max_discount_minor, free_shipping, active, starts_at, expires_at, usage_limit, used_count) VALUES
  (15, NULL, 'SEEDPCT10',   'percent', 10,    NULL,   NULL,   false, true,  NULL, NULL, NULL, 7),
  (15, NULL, 'SEEDFLAT200', 'flat',    20000, 99900,  NULL,   false, true,  NULL, NULL, 100, 3),
  (15, 4,    'SEEDCAP50',   'percent', 50,    NULL,   30000,  false, true,  NULL, NULL, 5,   5),
  (15, NULL, 'SEEDFREESHIP','flat',    0,     49900,  NULL,   true,  true,  NULL, NULL, NULL, 12),
  (15, NULL, 'SEEDEXPIRED', 'percent', 20,    NULL,   NULL,   false, true,  now() - interval '60 days', now() - interval '10 days', 50, 31),
  (15, NULL, 'SEEDFUTURE',  'percent', 15,    NULL,   NULL,   false, true,  now() + interval '14 days', now() + interval '45 days', NULL, 0),
  (15, NULL, 'SEEDOFF',     'percent', 25,    NULL,   NULL,   false, false, NULL, NULL, NULL, 2),
  (15, pg_temp.k('sf:export'), 'SEEDUSD5', 'flat', 500, 2000, NULL, false, true, NULL, NULL, 10, 0),
  (15, NULL, 'SEEDFULL100', 'percent', 100,   NULL,   NULL,   false, true,  NULL, NULL, 2, 1);

-- =====================================================================================================================================
-- 4. STORE: orders (every status, source and payment shape). Totals are derived from the lines below, never typed twice.
-- =====================================================================================================================================
CREATE TEMP TABLE o_src (
  okey text PRIMARY KEY, source text, phone text, cname text, email text, addr text, ship bigint, tax bigint, disc bigint, coupon text,
  pay text, rto smallint, band text, status text, sf bigint, wa_status text, txn text, ckey text, days_ago int, notes text, plink text,
  shopify text, woo text, incl boolean
);
INSERT INTO o_src VALUES
 ('o01','storefront','+919811100001','Meera Nair','meera.nair@seed.example','12 MG Road, Bengaluru 560001',4900,0,0,NULL,'prepaid',8,'low','completed',4,'captured','pay_SEED0001','c:meera.nair',40,NULL,NULL,NULL,NULL,false),
 ('o02','storefront','+919812345678','Aarav Sharma','aarav@example.com','Flat 4B, Palm Heights, Pune 411001',0,0,20000,'SEEDFLAT200','prepaid',12,'low','shipped',4,'paid','pay_SEED0002','c:aarav',22,'Gift wrap please',NULL,NULL,NULL,false),
 ('o03','storefront','+919898765432','Priya Patel','priya@example.com','88 CG Road, Ahmedabad 380009',4900,0,0,NULL,'cod',74,'high','new',4,NULL,NULL,'c:priya',1,'Call before delivery',NULL,NULL,NULL,false),
 ('o04','waba','+919811100002','Rohan','NULL','Near Metro Station, Delhi 110001',4900,0,0,NULL,'prepaid',35,'medium','pending',4,'pending',NULL,'c:rohan',2,NULL,'https://pay.seed.example/l/abc123',NULL,NULL,false),
 ('o05','storefront',NULL,'Guest Checkout (no phone, no contact)',NULL,NULL,0,0,0,NULL,'prepaid',NULL,NULL,'confirmed',4,'authorized',NULL,NULL,3,'Guest order, nothing to link',NULL,NULL,NULL,false),
 ('o06','storefront','+4915112345678','Zoë Müller-Åström 渡辺','zoe.muller@seed.example','Hauptstraße 5\nApt 3\n10115 Berlin\nGermany',0,0,0,NULL,'prepaid',20,'low','processing',pg_temp.k('sf:export'),'captured','pi_SEED0006','c:zoe.muller',6,'Ship to Germany. Notes with ünïcödé and 🙂',NULL,NULL,NULL,false),
 ('o07','storefront','+919811100001','Meera Nair','meera.nair@seed.example','12 MG Road, Bengaluru 560001',0,0,0,NULL,'prepaid',8,'low','cancelled',4,'refunded','pay_SEED0007','c:meera.nair',18,'Cancelled by customer within 1h',NULL,NULL,NULL,false),
 ('o08','storefront','+919812345678','Aarav Sharma','aarav@example.com','Flat 4B, Palm Heights, Pune 411001',0,0,0,NULL,'prepaid',12,'low','cancelled',4,'failed','pay_SEED0008','c:aarav',9,'Payment failed three times',NULL,NULL,NULL,false),
 ('o09','storefront','+919898765432','Priya Patel','priya@example.com','88 CG Road, Ahmedabad 380009',4900,0,0,NULL,'cod',91,'high','cancelled',4,NULL,NULL,'c:priya',15,'RTO: refused at the door',NULL,NULL,NULL,false),
 ('o10','shopify','+919811100003','Opted Out Buyer','optout@seed.example','Kolkata 700001',0,0,0,NULL,'prepaid',NULL,NULL,'paid',4,'paid',NULL,'c:optout',11,NULL,NULL,'5551230001',NULL,false),
 ('o11','woocommerce',NULL,'Woo Customer',NULL,NULL,0,0,0,NULL,'prepaid',NULL,NULL,'paid',4,'paid',NULL,NULL,7,'No phone from WooCommerce',NULL,NULL,'7001',false),
 ('o12','storefront','+919811100001','Meera Nair','meera.nair@seed.example','12 MG Road, Bengaluru 560001',0,0,0,'SEEDFULL100','prepaid',8,'low','completed',4,'paid',NULL,'c:meera.nair',5,'100% coupon: total is shipping only',NULL,NULL,NULL,false),
 ('o13','storefront','+919812345678','Aarav Sharma','aarav@example.com','Flat 4B, Palm Heights, Pune 411001',0,0,0,NULL,'prepaid',12,'low','completed',4,'captured','pay_SEED0013','c:aarav',30,'High value order',NULL,NULL,NULL,false),
 ('o14','storefront','+919811100002','Rohan','NULL','Near Metro Station, Delhi 110001',4900,5000,0,NULL,'prepaid',35,'medium','paid',4,'paid','pay_SEED0014','c:rohan',4,'Tax inclusive (5000 of the total)',NULL,NULL,NULL,true),
 ('o15','waba','+919598765432','Unknown WhatsApp Buyer',NULL,NULL,4900,0,0,NULL,'cod',50,'medium','new',4,NULL,NULL,NULL,0,'Phone not in the CRM yet',NULL,NULL,NULL,false),
 ('o16','storefront','+919898765432','Priya Patel','priya@example.com','88 CG Road, Ahmedabad 380009',0,0,0,'SEEDCAP50','prepaid',12,'low','shipped',4,'paid','pay_SEED0016','c:priya',13,'Coupon capped at 300',NULL,NULL,NULL,false),
 ('o17','storefront','+919811100001','Meera Nair','meera.nair@seed.example','12 MG Road, Bengaluru 560001',4900,0,0,NULL,'prepaid',8,'low','pending',4,'pending',NULL,'c:meera.nair',0,'Awaiting a payment link to be paid',NULL,NULL,NULL,false),
 ('o18','storefront','+919811100001','Meera Nair','meera.nair@seed.example','12 MG Road, Bengaluru 560001',4900,0,0,NULL,'prepaid',8,'low','paid',4,'partially_refunded','pay_SEED0018','c:meera.nair',25,'Partially refunded after a return',NULL,NULL,NULL,false);

-- the "NULL" email placeholder above is a literal string: normalise
UPDATE o_src SET email = NULL WHERE email = 'NULL';

CREATE TEMP TABLE o_lines (okey text, pkey text, qty int, price_override bigint);
INSERT INTO o_lines VALUES
 ('o01','p:TEE001',2,NULL),('o01','p:UNI011',1,NULL),
 ('o02','p:HOOD002',1,NULL),('o02','p:CAP004',1,NULL),
 ('o03','p:TEE001',1,NULL),
 ('o04','p:UNI011',3,NULL),
 ('o05','p:CAP004',1,NULL),('o05','p:FREE005',2,NULL),
 ('o06','p:USD001',2,NULL),('o06','p:USD003',1,NULL),
 ('o07','p:HOOD002',1,NULL),
 ('o08','p:REF009',1,NULL),
 ('o09','p:TEE001',3,NULL),('o09','p:SOCK003',2,NULL),
 ('o10','p:SHOP012',2,NULL),
 ('o11','p:WOO013',1,NULL),
 ('o12','p:UNI011',2,NULL),
 ('o13','p:LUX006',1,NULL),
 ('o14','p:LOW014',2,NULL),
 ('o15','p:TEE001',1,NULL),('o15','p:CAP004',2,NULL),
 ('o16','p:HOOD002',2,NULL),
 ('o17','p:USED010',1,NULL),
 ('o18','p:REF009',1,NULL),('o18','p:UNI011',1,NULL),
 -- a line whose product was deleted/renamed since (product_id null, price frozen)
 ('o01','p:GONE',1,15000);
INSERT INTO k VALUES ('p:GONE', 0);

INSERT INTO wa_orders (org_id, source, customer_phone, customer_name, customer_email, customer_address, items_json, total_minor, shipping_minor, tax_minor, tax_inclusive,
                       discount_minor, coupon_code, payment_method, rto_score, rto_band, currency_code, status, payment_link, notes, wa_message_id, storefront_id,
                       shopify_order_id, woo_order_id, meta_json, recovery_token, wa_payment_reference_id, wa_payment_status, wa_payment_txn_id, contact_id,
                       created_at, updated_at)
SELECT 15, s.source, s.phone, s.cname, s.email, s.addr, '[]'::jsonb, 0, s.ship, s.tax, s.incl, s.disc, s.coupon, s.pay, s.rto, s.band,
       CASE WHEN s.sf = pg_temp.k('sf:export') THEN 'USD' ELSE 'INR' END, s.status, s.plink, s.notes,
       CASE WHEN s.source = 'waba' THEN 'wamid.SEED' || s.okey END, s.sf, s.shopify, s.woo, jsonb_build_object('seed', 'interakt-store-edge', 'key', s.okey),
       CASE WHEN s.okey IN ('o17') THEN 'seedrecov' || s.okey END, 'REF-' || upper(s.okey), s.wa_status, s.txn,
       CASE WHEN s.ckey IS NULL THEN NULL ELSE pg_temp.k(s.ckey) END,
       now() - make_interval(days => s.days_ago, hours => 2), now() - make_interval(days => s.days_ago)
  FROM o_src s;
INSERT INTO k SELECT 'o:' || (meta_json->>'key'), id FROM wa_orders WHERE org_id = 15 AND meta_json->>'seed' = 'interakt-store-edge';

INSERT INTO wa_order_items (org_id, order_id, product_id, retailer_id, name, image_url, quantity, price_minor, currency_code, meta_json)
SELECT 15, pg_temp.k('o:' || l.okey), CASE WHEN l.pkey = 'p:GONE' THEN NULL ELSE pg_temp.k(l.pkey) END,
       CASE WHEN l.pkey = 'p:GONE' THEN 'SEED-GONE-999' ELSE p.sku END,
       CASE WHEN l.pkey = 'p:GONE' THEN 'Deleted Product (name kept on the order)' ELSE p.name END,
       p.image_url, l.qty, COALESCE(l.price_override, p.price_minor), COALESCE(p.currency_code, 'INR'), '{"seed":true}'::jsonb
  FROM o_lines l LEFT JOIN wa_products p ON p.org_id = 15 AND p.id = pg_temp.k(l.pkey) AND l.pkey <> 'p:GONE';

UPDATE wa_orders o SET
  items_json = x.items,
  total_minor = GREATEST(0, x.sub + o.shipping_minor + CASE WHEN o.tax_inclusive THEN 0 ELSE o.tax_minor END - o.discount_minor)
 FROM (SELECT order_id, sum(price_minor * quantity) sub,
              jsonb_agg(jsonb_build_object('retailer_id', retailer_id, 'name', name, 'quantity', quantity, 'price_minor', price_minor) ORDER BY id) items
         FROM wa_order_items WHERE org_id = 15 AND meta_json->>'seed' = 'true' GROUP BY order_id) x
WHERE o.org_id = 15 AND o.id = x.order_id;

-- coupon redemptions are tracked on the platform side only; the store keeps wa_coupons.used_count (set above)

-- guest/pending carts and the WhatsApp ordering inbox
INSERT INTO wa_pending_orders (org_id, customer_phone, ref, items_json, unavailable_json, total_minor, currency_code, customer_lang, ship_name, ship_company, ship_address,
                               group_code, status, order_id, expires_at) VALUES
  (15, '+919811100001', 'SEEDPEND01', '[{"retailer_id":"SEED-TEE-001","name":"Classic Cotton Tee","quantity":2,"price_minor":49900}]', '[]', 99800, 'INR', 'en', 'Meera Nair', NULL, '12 MG Road, Bengaluru', NULL, 'pending', NULL, now() + interval '1 day'),
  (15, '+919811100002', 'SEEDPEND02', '[{"retailer_id":"SEED-SOCK-003","name":"Crew Socks 3-pack","quantity":1,"price_minor":29900}]', '[{"retailer_id":"SEED-SOCK-003","reason":"out_of_stock"}]', 29900, 'INR', 'hi', 'Rohan', 'Seed Co', 'Delhi', 'GRP-1', 'pending', NULL, now() + interval '2 hours'),
  (15, '+919812345678', 'SEEDPEND03', '[]', '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL, 'expired', NULL, now() - interval '3 days'),
  (15, '+919898765432', 'SEEDPEND04', '[{"retailer_id":"SEED-HOOD-002","name":"Hoodie","quantity":1,"price_minor":189900}]', '[]', 189900, 'INR', 'en', 'Priya Patel', NULL, '88 CG Road', NULL, 'converted', pg_temp.k('o:o16'), now() - interval '12 days'),
  (15, '+919811100003', 'SEEDPEND05', '[{"retailer_id":"SEED-UNI-011","name":"चाय मसाला","quantity":1,"price_minor":24900}]', '[]', 24900, 'INR', 'hi', 'Opted Out', NULL, 'Kolkata', NULL, 'cancelled', NULL, now() - interval '1 day');

INSERT INTO wa_product_reviews (org_id, storefront_id, product_id, order_id, customer_name, rating, body, status) VALUES
  (15, 4, pg_temp.k('p:TEE001'),  pg_temp.k('o:o01'), 'Meera N.',  5, 'Fits perfectly and the fabric is lovely.', 'approved'),
  (15, 4, pg_temp.k('p:TEE001'),  NULL, NULL,        1, NULL, 'pending'),
  (15, 4, pg_temp.k('p:TEE001'),  pg_temp.k('o:o02'), 'Aarav',     3, repeat('Long review text. ', 100), 'approved'),
  (15, 4, pg_temp.k('p:HOOD002'), pg_temp.k('o:o16'), 'Priya P.',  4, 'Warm, a little long in the sleeves.', 'approved'),
  (15, 4, pg_temp.k('p:HOOD002'), NULL, 'Spammer',   5, 'BUY CHEAP WATCHES http://spam.example', 'rejected'),
  (15, 4, pg_temp.k('p:UNI011'),  pg_temp.k('o:o12'), 'Zoë 渡辺 🙂', 5, 'बहुत बढ़िया चाय! Great aroma.', 'approved'),
  (15, NULL, pg_temp.k('p:NOSHOP015'), NULL, 'No shop', 2, 'Review on a product with no storefront', 'pending'),
  (15, 4, pg_temp.k('p:LUX006'),  pg_temp.k('o:o13'), 'Aarav',     5, 'Worth every rupee.', 'pending');

INSERT INTO storefront_cart_recoveries (org_id, storefront_id, customer_phone, customer_name, items_json, subtotal_minor, currency_code, scheduled_ids, status, nudge_at, nudged_at) VALUES
  (15, 4, '+919811100001', 'Meera Nair', '[{"retailer_id":"SEED-TEE-001","quantity":2,"price_minor":49900}]', 99800, 'INR', '[]', 'active',   now() + interval '20 minutes', NULL),
  (15, 4, '+919811100002', 'Rohan',      '[{"retailer_id":"SEED-HOOD-002","quantity":1,"price_minor":189900}]', 189900, 'INR', '["job-1"]', 'active', now() - interval '1 hour', now() - interval '55 minutes'),
  (15, 4, '+919812345678', 'Aarav Sharma', '[{"retailer_id":"SEED-LUX-006","quantity":1,"price_minor":9999900}]', 9999900, 'INR', '[]', 'recovered', now() - interval '2 days', now() - interval '2 days'),
  (15, 4, '+919898765432', NULL,         '[]', 0, 'INR', NULL, 'cancelled', NULL, NULL),
  (15, pg_temp.k('sf:verified'), '+919811100003', 'Opted Out Buyer', '[{"retailer_id":"x","quantity":1,"price_minor":1000}]', 1000, 'INR', '[]', 'active', now() + interval '5 hours', NULL);

-- =====================================================================================================================================
-- 5. INVOICING: settings and number sequences
-- =====================================================================================================================================
INSERT INTO invoice_settings (org_id, enabled, numbering_prefix, proforma_prefix, receipt_prefix, credit_note_prefix, sales_order_prefix, fy_reset, fy_start_month,
                              number_padding, number_format, tax_label, default_tax_rate, tax_inclusive_default, hsn_default, brand_color, footer_note, support_email,
                              seller_name, seller_address, seller_tax_id, seller_reg_no, seller_phone, seller_country, seller_state, default_tax_regime,
                              bank_details, payment_instructions, terms, due_days, overdue_reminders, auto_send_own, trigger_own, show_signature, signature_label, invoice_title)
VALUES (15, true, 'INV', 'PRO', 'RCT', 'CRN', 'SO', false, 4, 6, '{PREFIX}-{YEAR}-{SEQ}', 'GST', 18, false, '6109', '#0f766e',
        'Thank you for shopping with Interakt Demo Store', 'billing@seed.example',
        'Interakt Demo Store Pvt Ltd', '3rd Floor, Seed Tower, Koramangala, Bengaluru 560034', '29ABCDE1234F1Z5', 'U12345KA2020PTC123456', '+918012345678', 'IN', 'KA', 'gst',
        '{"bank":"Seed Bank","account":"000123456789","ifsc":"SEED0000001","upi":"seed@bank"}'::jsonb,
        'Pay by UPI seed@bank or bank transfer. Quote the invoice number.', 'Payment due within 15 days. Late fee 1.5% per month.', 15, true, false, 'on_paid', true, 'Authorised Signatory', 'TAX INVOICE')
ON CONFLICT DO NOTHING;
UPDATE invoice_settings SET enabled = true, due_days = 15 WHERE org_id = 15;

INSERT INTO invoice_number_sequences (org_id, series, next_seq) VALUES
  (15, 'INV-2026', 1), (15, 'PRO-2026', 1), (15, 'RCT-2026', 1), (15, 'CRN-2026', 1), (15, 'SO-2026', 1);

-- =====================================================================================================================================
-- 6. INVOICING: sales orders (draft, confirmed, partly invoiced, closed, cancelled)
-- =====================================================================================================================================
INSERT INTO sales_orders (org_id, series, seq, number, status, contact_id, company_id, owner_id, created_by, buyer_name, buyer_email, buyer_phone, currency, subtotal_minor, shipping_minor,
                          tax_minor, tax_added_minor, total_minor, reference, expected_date, notes, terms, confirmed_at, cancelled_at, cancel_reason, shipping_invoiced) VALUES
  (15, 'SO-2026', 1, 'SO-2026-000001', 'draft',     pg_temp.k('c:aarav'), NULL, 63, 63, 'Aarav Sharma', 'aarav@example.com', '+919812345678', 'INR', 200000, 0, 36000, 36000, 236000, 'PO-1001', current_date + 10, 'Draft: not confirmed yet', NULL, NULL, NULL, NULL, false),
  (15, 'SO-2026', 2, 'SO-2026-000002', 'draft', pg_temp.k('c:priya'), NULL, 63, 63, 'Priya Patel', 'priya@example.com', '+919898765432', 'INR', 300000, 10000, 54000, 54000, 364000, 'PO-1002', current_date + 5, 'Confirmed, nothing invoiced', 'Net 15', NULL, NULL, NULL, false),
  (15, 'SO-2026', 3, 'SO-2026-000003', 'draft', NULL, pg_temp.k('co:textiles'), 63, 63, 'SEED Textiles Pvt Ltd', 'accounts@seed-textiles.example', NULL, 'INR', 1000000, 0, 180000, 180000, 1180000, 'PO-SEED-77', current_date - 2, 'Partly invoiced, partly fulfilled', 'Net 30', NULL, NULL, NULL, false),
  (15, 'SO-2026', 4, 'SO-2026-000004', 'draft',     pg_temp.k('c:meera.nair'), NULL, 63, 63, 'Meera Nair', 'meera.nair@seed.example', '+919811100001', 'INR', 150000, 4900, 27000, 27000, 181900, NULL, current_date - 30, 'Fully invoiced and delivered', NULL, NULL, NULL, NULL, true),
  (15, 'SO-2026', 5, 'SO-2026-000005', 'draft', pg_temp.k('c:rohan'), NULL, 63, 63, 'Rohan', NULL, '+919811100002', 'INR', 80000, 0, 0, 0, 80000, 'PO-X', NULL, NULL, NULL, NULL, NULL, NULL, false);
INSERT INTO k SELECT 'so:' || seq, id FROM sales_orders WHERE org_id = 15 AND series = 'SO-2026';

INSERT INTO sales_order_items (org_id, order_id, sort, description, sku, hsn_sac, qty, qty_invoiced, qty_fulfilled, unit_price_minor, discount_kind, discount_value, discount_invoiced_minor,
                               tax_rate_id, tax_name, tax_rate_percent, tax_inclusive, line_subtotal_minor, line_discount_minor, tax_amount_minor, line_total_minor, currency) VALUES
  (15, pg_temp.k('so:1'), 0, 'Classic Cotton Tee x4', 'SEED-TEE-001', '6109', 4, 0, 0, 50000, 'none', 0, 0, pg_temp.k('tax:18'), 'SEED GST 18%', 18, false, 200000, 0, 36000, 236000, 'INR'),
  (15, pg_temp.k('so:2'), 0, 'Hoodie, Heavyweight', 'SEED-HOOD-002', '6110', 2, 0, 0, 150000, 'none', 0, 0, pg_temp.k('tax:18'), 'SEED GST 18%', 18, false, 300000, 0, 54000, 354000, 'INR'),
  (15, pg_temp.k('so:3'), 0, 'Bulk cotton fabric (metres)', 'SEED-FAB-001', '5208', 500, 0, 0, 2000, 'none', 0, 0, pg_temp.k('tax:18'), 'SEED GST 18%', 18, false, 1000000, 0, 180000, 1180000, 'INR'),
  (15, pg_temp.k('so:4'), 0, 'Masala Chai', 'SEED-UNI-011', '0902', 6, 0, 0, 25000, 'none', 0, 0, pg_temp.k('tax:18'), 'SEED GST 18%', 18, false, 150000, 0, 27000, 177000, 'INR'),
  (15, pg_temp.k('so:5'), 0, 'Cancelled item', NULL, NULL, 1, 0, 0, 80000, 'none', 0, 0, NULL, NULL, 0, false, 80000, 0, 0, 80000, 'INR');
-- lifecycle moves (the lines of a confirmed order are frozen, so status and progress change after the lines exist)
UPDATE sales_orders SET status = 'confirmed', confirmed_at = now() - interval '3 days'  WHERE org_id = 15 AND id = pg_temp.k('so:2');
UPDATE sales_orders SET status = 'confirmed', confirmed_at = now() - interval '20 days' WHERE org_id = 15 AND id = pg_temp.k('so:3');
UPDATE sales_order_items SET qty_invoiced = 300, qty_fulfilled = 200 WHERE org_id = 15 AND order_id = pg_temp.k('so:3');
UPDATE sales_orders SET status = 'confirmed', confirmed_at = now() - interval '40 days' WHERE org_id = 15 AND id = pg_temp.k('so:4');
UPDATE sales_order_items SET qty_invoiced = 6, qty_fulfilled = 6 WHERE org_id = 15 AND order_id = pg_temp.k('so:4');
UPDATE sales_orders SET status = 'closed' WHERE org_id = 15 AND id = pg_temp.k('so:4');
UPDATE sales_orders SET status = 'cancelled', cancelled_at = now() - interval '30 days', cancel_reason = 'Customer changed their mind' WHERE org_id = 15 AND id = pg_temp.k('so:5');

-- =====================================================================================================================================
-- 7. INVOICING: invoices in every state. Amounts are COMPUTED from the lines (same rules as the constraints), never typed twice.
-- =====================================================================================================================================
CREATE TEMP TABLE i_src (
  ikey text PRIMARY KEY, status text, doc text, source text, series text, seq int, ckey text, cokey text, buyer text, email text, phone text,
  cur text, exp smallint, dkind text, dval bigint, ship bigint, issued_ago int, due_days int, reg text, btax text, bcountry text, pos text,
  rc boolean, notes text, ref text, okey text, sokey text, ext_id text, ext_no text
);
INSERT INTO i_src VALUES
 --  key  status   doc          source        series      seq contact         company  buyer                 email                    phone           cur   exp dkind     dval  ship ago due  reg    btax             bc   pos     rc    notes ref   order sales ext  extno
 ('i01','issued','tax_invoice','manual',     'INV-2026', 1, 'c:aarav',       NULL, 'Aarav Sharma',       'aarav@example.com',     '+919812345678','INR', 2, 'none',    0,     0, 30, 15, 'gst', NULL,           'IN','IN-MH',false,'Paid in full by UPI',NULL,NULL,NULL,NULL,NULL),
 ('i02','issued','tax_invoice','manual',     'INV-2026', 2, 'c:priya',       NULL, 'Priya Patel',        'priya@example.com',     '+919898765432','INR', 2, 'none',    0,     0, 22, 10, 'gst', NULL,           'IN','IN-GJ',false,'Two part-payments so far','PO-1002',NULL,NULL,NULL,NULL),
 ('i03','issued','tax_invoice','manual',     'INV-2026', 3, 'c:16',          NULL, 'Overdue Customer',   NULL,                    '+919599398998','INR', 2, 'none',    0,     0, 45, 15, 'gst', NULL,           'IN','IN-DL',false,'Reminder sent twice, no reply',NULL,NULL,NULL,NULL,NULL),
 ('i04','draft', 'tax_invoice','manual',     NULL,       NULL,'c:18',        NULL, 'Draft Customer',     NULL,                    '+919599398998','INR', 2, 'none',    0,     0, 0,  NULL,'gst', NULL,           'IN',NULL,   false,'Draft: no number, no link yet',NULL,NULL,NULL,NULL,NULL),
 ('i05','draft', 'tax_invoice','manual',     NULL,       NULL,NULL,          NULL, 'Walk-in (no contact)',NULL,                   NULL,           'INR', 2, 'none',    0,     0, 0,  NULL,'none',NULL,           NULL,NULL,   false,NULL,NULL,NULL,NULL,NULL,NULL),
 ('i06','void',  'tax_invoice','manual',     'INV-2026', 4, 'c:meera.nair',  NULL, 'Meera Nair',         'meera.nair@seed.example','+919811100001','INR', 2, 'none',    0,     0, 25, 15, 'gst', NULL,           'IN','IN-KA',false,'Issued to the wrong customer',NULL,NULL,NULL,NULL,NULL),
 ('i07','issued','tax_invoice','manual',     'INV-2026', 5, 'c:meera.nair',  NULL, 'Meera Nair',         'meera.nair@seed.example','+919811100001','INR', 2, 'percent', 1000,  5000, 8,  7,  'gst', NULL,           'IN','IN-KA',false,'10% document discount plus shipping',NULL,NULL,NULL,NULL,NULL),
 ('i08','issued','tax_invoice','own',        'INV-2026', 6, 'c:rohan',       NULL, 'Rohan',              NULL,                    '+919811100002','INR', 2, 'none',    0,     0, 4,  0,  'gst', NULL,           'IN','IN-DL',false,'Tax-inclusive price',NULL,NULL,NULL,NULL,NULL),
 ('i09','issued','tax_invoice','manual',     'INV-2026', 7, 'c:zoe.muller',  NULL, 'Zoë Müller-Åström 渡辺','zoe.muller@seed.example','+4915112345678','USD', 2, 'none',    0,     0, 6,  14, 'export','DE123456789','DE','DE',true, 'Reverse charge: customer accounts for the tax','EU-PO-9',NULL,NULL,NULL,NULL),
 ('i10','issued','tax_invoice','manual',     'INV-2026', 8, 'c:zoe.muller',  NULL, 'Tokyo Branch (JPY, 0 decimals)',NULL,         NULL,           'JPY', 0, 'none',    0,     0, 12, 30, 'none',NULL,            'JP',NULL,   false,'Currency with no minor unit',NULL,NULL,NULL,NULL,NULL),
 ('i11','issued','tax_invoice','manual',     'INV-2026', 9, NULL,            NULL, 'Kuwait Trading (KWD, 3 decimals)',NULL,       NULL,           'KWD', 3, 'none',    0,     0, 10, 30, 'none',NULL,            'KW',NULL,   false,'Currency with three decimals',NULL,NULL,NULL,NULL,NULL),
 ('i12','issued','proforma',   'manual',     'PRO-2026', 1, 'c:priya',       NULL, 'Priya Patel',        'priya@example.com',     '+919898765432','INR', 2, 'none',    0,     0, 3,  7,  'gst', NULL,           'IN','IN-GJ',false,'Proforma: not a tax document',NULL,NULL,NULL,NULL,NULL),
 ('i13','issued','tax_invoice','order',      'INV-2026',10, 'c:aarav',       NULL, 'Aarav Sharma',       'aarav@example.com',     '+919812345678','INR', 2, 'amount',  20000, 0, 22, 0,  'none',NULL,            'IN',NULL,   false,'From the store order, coupon applied',NULL,'o02',NULL,NULL,NULL),
 ('i14','issued','receipt',    'manual',     'RCT-2026', 1, 'c:meera.nair',  NULL, 'Meera Nair',         'meera.nair@seed.example','+919811100001','INR', 2, 'none',    0,     0, 14, NULL,'none',NULL,           'IN',NULL,   false,'Receipt document',NULL,NULL,NULL,NULL,NULL),
 ('i15','issued','tax_invoice','manual',     'INV-2026',11, 'c:priya',       NULL, 'Priya Patel',        'priya@example.com',     '+919898765432','INR', 2, 'none',    0,     0, 28, 15, 'gst', NULL,           'IN','IN-GJ',false,'Paid, then refunded in full',NULL,NULL,NULL,NULL,NULL),
 ('i16','issued','tax_invoice','manual',     'INV-2026',12, 'c:aarav',       NULL, 'Aarav Sharma',       'aarav@example.com',     '+919812345678','INR', 2, 'none',    0,     0, 26, 15, 'none',NULL,            'IN',NULL,   false,'Partially refunded',NULL,NULL,NULL,NULL,NULL),
 ('i17','issued','tax_invoice','manual',     'INV-2026',13, 'c:meera.nair',  NULL, 'Meera Nair',         'meera.nair@seed.example','+919811100001','INR', 2, 'none',    0,     0, 20, 15, 'gst', NULL,           'IN','IN-KA',false,'Credit note issued, refunded to the customer',NULL,NULL,NULL,NULL,NULL),
 ('i18','issued','tax_invoice','manual',     'INV-2026',14, 'c:priya',       NULL, 'Priya Patel',        'priya@example.com',     '+919898765432','INR', 2, 'none',    0,     0, 19, 15, 'gst', NULL,           'IN','IN-GJ',false,'Credit note settles the balance, nothing paid',NULL,NULL,NULL,NULL,NULL),
 ('i19','issued','tax_invoice','manual',     'INV-2026',15, 'c:rohan',       NULL, 'Rohan',              NULL,                    '+919811100002','INR', 2, 'none',    0,     0, 16, 15, 'gst', NULL,           'IN','IN-DL',false,'Customer paid more than the total',NULL,NULL,NULL,NULL,NULL),
 ('i20','issued','tax_invoice','woocommerce','INV-2026',16, NULL,            NULL, 'Woo Customer',       NULL,                    NULL,           'INR', 2, 'none',    0,     0, 7,  0,  'gst', NULL,           'IN',NULL,   false,'Auto-created from a WooCommerce order',NULL,'o11',NULL,'7001','#7001'),
 ('i21','issued','tax_invoice','shopify',    'INV-2026',17, 'c:optout',      NULL, 'Opted Out Buyer',    'optout@seed.example',   '+919811100003','INR', 2, 'none',    0,     0, 11, 0,  'gst', NULL,           'IN','IN-WB',false,'Auto-created from a Shopify order',NULL,'o10',NULL,'5551230001','#SEED-1001'),
 ('i22','issued','tax_invoice','api',        'INV-2026',18, 'c:email.only',  NULL, 'Email Only Customer','email.only@seed.example',NULL,          'INR', 2, 'none',    0,     0, 9,  15, 'gst', NULL,           'IN',NULL,   false,'Created through the API',NULL,NULL,NULL,NULL,NULL),
 ('i23','issued','tax_invoice','ai',         'INV-2026',19, 'c:aarav',       NULL, 'Aarav Sharma',       'aarav@example.com',     '+919812345678','INR', 2, 'none',    0,     0, 2,  15, 'gst', NULL,           'IN','IN-MH',false,'Drafted by the AI assistant',NULL,NULL,NULL,NULL,NULL),
 ('i24','issued','tax_invoice','sales_order','INV-2026',20, NULL,            'co:textiles','SEED Textiles Pvt Ltd','accounts@seed-textiles.example',NULL,'INR', 2, 'none',    0,     0, 18, 30, 'gst', '27AAPFU0939F1ZV','IN','IN-MH',false,'First part of sales order SO-2026-000003','PO-SEED-77',NULL,'so:3',NULL,NULL),
 ('i25','issued','tax_invoice','manual',     'INV-2026',21, 'c:aarav',       NULL, 'Aarav Sharma',       'aarav@example.com',     '+919812345678','INR', 2, 'none',    0,     0, 5,  15, 'none',NULL,            'IN',NULL,   false,'Zero-value invoice (free sample)',NULL,NULL,NULL,NULL,NULL),
 ('i26','issued','tax_invoice','manual',     'INV-2026',22, NULL,            'co:textiles','SEED Textiles Pvt Ltd','accounts@seed-textiles.example',NULL,'INR', 2, 'none',    0,     0, 34, 60, 'gst', '27AAPFU0939F1ZV','IN','IN-MH',false,'Very large invoice, paid by cheque in parts','PO-BIG-1',NULL,NULL,NULL,NULL),
 ('i27','issued','tax_invoice','manual',     'INV-2026',23, 'c:zoe.muller',  NULL, 'Zoë Müller-Åström 渡辺','zoe.muller@seed.example','+4915112345678','INR', 2, 'none',    0,     0, 13, 15, 'gst', NULL,           'DE',NULL,   false,repeat('Unicode and long notes: ünïcödé ✓ 渡辺 🙂. ',30),'REF/ÄÖÜ-2026/#7',NULL,NULL,NULL,NULL),
 ('i28','issued','tax_invoice','manual',     'INV-2026',24, 'c:aarav',       NULL, 'Aarav Sharma',       'aarav@example.com',     '+919812345678','INR', 2, 'none',    0,     0, 6,  NULL,'gst', NULL,           'IN','IN-MH',false,'No due date (terms never set)',NULL,NULL,NULL,NULL,NULL);

CREATE TEMP TABLE i_lines (ikey text, sort smallint, descr text, sku text, hsn text, qty numeric, unit bigint, lkind text, lval bigint, taxkey text, tname text, pct numeric, incl boolean);
INSERT INTO i_lines VALUES
 ('i01',0,'Classic Cotton Tee','SEED-TEE-001','6109',2,120000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i01',1,'Crew Socks 3-pack','SEED-SOCK-003','6115',1,59900,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i02',0,'Annual maintenance retainer',NULL,'9987',1,500000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i03',0,'Consulting: 6 hours',NULL,'9983',6,20000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i04',0,'Draft line item',NULL,NULL,1,80000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i05',0,'Counter sale item',NULL,NULL,3,10000,'none',0,NULL,NULL,0,false),
 ('i06',0,'Mistaken sale',NULL,'6109',1,70000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i07',0,'Hoodie, Heavyweight','SEED-HOOD-002','6110',4,50000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i08',0,'Low Stock Notebook (incl. 5% GST)','SEED-LOW-014','4820',5,21000,'none',0,'tax:5i','SEED GST 5% (inclusive)',5,true),
 ('i09',0,'Software licence (EU, reverse charge)',NULL,'9973',1,250000,'none',0,NULL,NULL,0,false),
 ('i10',0,'Imported fabric (JPY)',NULL,'5208',3,500000,'none',0,NULL,NULL,0,false),
 ('i11',0,'Trading sample (KWD)',NULL,NULL,1,75500,'none',0,NULL,NULL,0,false),
 ('i12',0,'Pro-forma: Dad Cap x2','SEED-CAP-004','6505',2,50000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i13',0,'Hoodie + Dad Cap bundle (store order o02)','SEED-HOOD-002','6110',1,224800,'none',0,NULL,NULL,0,false),
 ('i14',0,'Receipt for advance',NULL,NULL,1,50000,'none',0,NULL,NULL,0,false),
 ('i15',0,'Camera accessories',NULL,'9006',1,100000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i16',0,'Refurbished Speaker','SEED-REF-009','8518',1,300000,'none',0,NULL,NULL,0,false),
 ('i17',0,'Hoodie x1','SEED-HOOD-002','6110',1,100000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i18',0,'Tee x1','SEED-TEE-001','6109',1,50000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i19',0,'Speaker repair',NULL,'9987',1,100000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i20',0,'Imported From WooCommerce','SEED-WOO-013','6109',1,64900,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i21',0,'Imported From Shopify','SEED-SHOP-012','6109',2,79900,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i22',0,'API-created service fee',NULL,'9987',1,40000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i22',1,'Exempt line',NULL,'9987',1,10000,'none',0,'tax:0','SEED GST 0% (exempt)',0,false),
 ('i23',0,'AI quote follow-up item',NULL,NULL,2,35000,'percent',500,'tax:18','SEED GST 18%',18,false),
 ('i24',0,'Bulk cotton fabric, 300 m (part 1 of 500)','SEED-FAB-001','5208',300,2000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i25',0,'Free Sticker Sheet (sample)','SEED-FREE-005','4911',1,0,'none',0,NULL,NULL,0,false),
 ('i26',0,'Enterprise annual licence',NULL,'9973',1,2500000000,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i27',0,'Hand-made item with a very long description ' || repeat('lorem ipsum ', 30),'SEED-UNI-011','0902',1,24900,'none',0,'tax:18','SEED GST 18%',18,false),
 ('i28',0,'Support hours',NULL,'9987',10,15000,'amount',10000,'tax:18','SEED GST 18%',18,false);

-- per-line maths (single-line documents carry the document discount as the line's share)
CREATE TEMP TABLE i_calc AS
SELECT l.*, s.dkind, s.dval,
       round(l.qty * l.unit)::bigint AS sub,
       CASE l.lkind WHEN 'percent' THEN round(round(l.qty * l.unit) * l.lval / 10000.0) WHEN 'amount' THEN least(l.lval, round(l.qty * l.unit)) ELSE 0 END::bigint AS ldisc
  FROM i_lines l JOIN i_src s USING (ikey);
ALTER TABLE i_calc ADD COLUMN share bigint, ADD COLUMN tax bigint;
UPDATE i_calc SET share = CASE dkind WHEN 'percent' THEN round((sub - ldisc) * dval / 10000.0) WHEN 'amount' THEN least(dval, sub - ldisc) ELSE 0 END;
UPDATE i_calc SET tax = CASE WHEN incl THEN (sub - ldisc - share) - round((sub - ldisc - share) / (1 + pct / 100.0))
                             ELSE round((sub - ldisc - share) * pct / 100.0) END;

INSERT INTO invoices (org_id, user_id, owner_id, source, doc_type, wa_order_id, external_order_id, external_order_number, series, invoice_number, seq, status, send_status, trigger,
                      issued_at, currency, currency_exponent, subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor, tax_inclusive, buyer_name, buyer_email, buyer_phone,
                      billing_json, shipping_json, seller_snapshot_json, notes, contact_id, company_id, reference, terms, issue_date, due_date, payment_status, discount_kind, discount_value,
                      voided_at, voided_by, void_reason, public_token_hash, tax_regime, buyer_tax_id, buyer_country, place_of_supply, reverse_charge, tax_added_minor, sales_order_id,
                      created_at, meta_json)
SELECT 15, 63, 63, s.source, s.doc, CASE WHEN s.okey IS NULL THEN NULL ELSE pg_temp.k('o:' || s.okey) END, s.ext_id, s.ext_no,
       NULL, NULL, NULL,
       'draft', 'pending', 'manual',
       NULL,
       s.cur, s.exp,
       a.sub, a.disc, s.ship, a.tax, a.sub - a.disc + a.tax_added + s.ship,
       a.incl,
       s.buyer, s.email, s.phone,
       jsonb_build_object('name', s.buyer, 'address', 'Seed Street 1' || E'\n' || 'Seed City', 'country', s.bcountry),
       CASE WHEN s.okey IS NOT NULL THEN jsonb_build_object('name', s.buyer, 'address', '12 Seed Lane') END,
       jsonb_build_object('name', 'Interakt Demo Store Pvt Ltd', 'taxId', '29ABCDE1234F1Z5', 'country', 'IN'),
       s.notes,
       CASE WHEN s.ckey IS NULL THEN NULL ELSE pg_temp.k(s.ckey) END,
       CASE WHEN s.cokey IS NULL THEN NULL ELSE pg_temp.k(s.cokey) END,
       s.ref, CASE WHEN s.doc = 'tax_invoice' THEN 'Payment due within 15 days.' END,
       NULL, NULL,
       'unpaid', s.dkind, s.dval,
       NULL, NULL, NULL, NULL,
       s.reg, s.btax, s.bcountry, s.pos, s.rc, a.tax_added,
       CASE WHEN s.sokey IS NULL THEN NULL ELSE pg_temp.k(s.sokey) END,
       now() - make_interval(days => s.issued_ago + 1), jsonb_build_object('seed', 'interakt-store-edge', 'key', s.ikey)
  FROM i_src s
  JOIN (SELECT ikey, sum(sub) sub, sum(ldisc + share) disc, sum(tax) tax, sum(CASE WHEN incl THEN 0 ELSE tax END) tax_added, bool_or(incl) incl FROM i_calc GROUP BY ikey) a USING (ikey);
INSERT INTO k SELECT 'i:' || (meta_json->>'key'), id FROM invoices WHERE org_id = 15 AND meta_json->>'seed' = 'interakt-store-edge';
UPDATE invoice_number_sequences SET next_seq = 25 WHERE org_id = 15 AND series = 'INV-2026';
UPDATE invoice_number_sequences SET next_seq = 2 WHERE org_id = 15 AND series IN ('PRO-2026', 'RCT-2026');

INSERT INTO invoice_items (org_id, invoice_id, sort, description, sku, hsn_sac, qty, unit_price_minor, line_subtotal_minor, line_discount_minor, tax_amount_minor, currency, tax_rate_id, tax_name,
                           tax_inclusive, discount_kind, discount_value, doc_discount_share_minor, line_total_minor, tax_rate_percent, sales_order_item_id)
SELECT 15, pg_temp.k('i:' || c.ikey), c.sort, left(c.descr, 500), c.sku, c.hsn, c.qty, c.unit, c.sub, c.ldisc, c.tax, s.cur,
       CASE WHEN c.taxkey IS NULL THEN NULL ELSE pg_temp.k(c.taxkey) END, c.tname, c.incl, c.lkind, c.lval, c.share,
       c.sub - c.ldisc - c.share + CASE WHEN c.incl THEN 0 ELSE c.tax END, c.pct,
       CASE WHEN c.ikey = 'i24' THEN (SELECT id FROM sales_order_items WHERE org_id = 15 AND order_id = pg_temp.k('so:3')) END
  FROM i_calc c JOIN i_src s USING (ikey);

INSERT INTO invoice_tax_summary (org_id, invoice_id, tax_label, base_minor, amount_minor, inclusive, rate_percent)
SELECT 15, pg_temp.k('i:' || ikey), tname, sum(sub - ldisc - share), sum(tax), incl, pct
  FROM i_calc WHERE tname IS NOT NULL GROUP BY ikey, tname, incl, pct;

-- issue / void: the lines above were written while each invoice was a draft (an issued invoice's lines are frozen)
UPDATE invoices i SET
  status = s.status, series = s.series, invoice_number = s.series || '-' || lpad(s.seq::text, 6, '0'), seq = s.seq,
  issued_at = now() - make_interval(days => s.issued_ago), issue_date = current_date - s.issued_ago,
  due_date = CASE WHEN s.due_days IS NOT NULL THEN current_date - s.issued_ago + s.due_days END,
  public_token_hash = md5('seedtoken' || s.ikey) || md5('seedtoken2' || s.ikey),
  voided_at = CASE WHEN s.status = 'void' THEN now() - interval '24 days' END, voided_by = CASE WHEN s.status = 'void' THEN 63 END,
  void_reason = CASE WHEN s.status = 'void' THEN s.notes END
 FROM i_src s WHERE i.org_id = 15 AND i.id = pg_temp.k('i:' || s.ikey) AND s.status <> 'draft';

-- link orders to their invoices and sales orders
UPDATE wa_orders o SET invoice_id = pg_temp.k('i:i13') WHERE org_id = 15 AND id = pg_temp.k('o:o02');
UPDATE wa_orders o SET invoice_id = pg_temp.k('i:i20') WHERE org_id = 15 AND id = pg_temp.k('o:o11');
UPDATE wa_orders o SET invoice_id = pg_temp.k('i:i21') WHERE org_id = 15 AND id = pg_temp.k('o:o10');
UPDATE wa_orders o SET sales_order_id = pg_temp.k('so:4') WHERE org_id = 15 AND id = pg_temp.k('o:o01');

-- how each invoice was delivered / viewed (not frozen fields)
UPDATE invoices SET send_status = 'sent', delivery_channel = 'email', sent_at = issued_at + interval '5 minutes', delivered_at = issued_at + interval '6 minutes', send_attempts = 1
 WHERE org_id = 15 AND meta_json->>'key' IN ('i01', 'i02', 'i07', 'i17');
UPDATE invoices SET send_status = 'sent', delivery_channel = 'whatsapp', sent_at = issued_at + interval '2 minutes', delivered_at = issued_at + interval '3 minutes',
                    wa_message_id = 'wamid.SEEDINV' || id, send_attempts = 1
 WHERE org_id = 15 AND meta_json->>'key' IN ('i03', 'i13', 'i22');
UPDATE invoices SET send_status = 'failed', delivery_channel = 'whatsapp', send_attempts = 4, send_reason = 'recipient_not_on_whatsapp', send_error = '131026: Message undeliverable'
 WHERE org_id = 15 AND meta_json->>'key' IN ('i19', 'i24');
UPDATE invoices SET first_viewed_at = issued_at + interval '1 hour', last_viewed_at = now() - interval '2 hours', view_count = 7
 WHERE org_id = 15 AND meta_json->>'key' IN ('i01', 'i03', 'i07');
UPDATE invoices SET token_revoked_at = now() - interval '1 day' WHERE org_id = 15 AND meta_json->>'key' = 'i09';
UPDATE invoices SET token_expires_at = now() - interval '2 days' WHERE org_id = 15 AND meta_json->>'key' = 'i28';
UPDATE invoices SET overdue_at = due_date::timestamptz + interval '1 day' WHERE org_id = 15 AND status = 'issued' AND due_date < current_date;
UPDATE invoices SET pdf_disk = 'local', pdf_path = 'seed/' || invoice_number || '.pdf', pdf_sha256 = md5(invoice_number) || md5(invoice_number || 'x'), pdf_bytes = 48213
 WHERE org_id = 15 AND meta_json->>'key' IN ('i01', 'i02', 'i07', 'i13');

-- =====================================================================================================================================
-- 8. PAYMENTS (append-only ledger; the invoice's paid state is derived by the trigger) and credit notes
-- =====================================================================================================================================
CREATE TEMP TABLE p_src (pkey text, ikey text, amount bigint, method text, source text, ago int, ref text, gw text, rcpt text, note text, okey text);
INSERT INTO p_src VALUES
 ('p01','i01', 353882,'upi',    'manual',  29,'UPI/SEED/0001',NULL,'RCT-2026-000001','Paid by UPI in full',NULL),
 ('p02','i02', 200000,'bank',   'manual',  20,'NEFT-SEED-77',NULL,NULL,'First instalment',NULL),
 ('p03','i02', 150000,'cash',   'manual',   5,NULL,NULL,NULL,'Second instalment, cash at counter',NULL),
 ('p04','i08', 105000,'storefront','storefront',4,'ORD-o14','pay_SEED0014',NULL,'Paid on the storefront',NULL),
 ('p05','i09', 250000,'gateway','gateway',   5,'pi_SEED0009','pi_SEED0009',NULL,'Stripe payment',NULL),
 ('p06','i10', 600000,'card',   'manual',   10,'POS-JP-1',NULL,NULL,'Deposit for a JPY invoice (0 decimals)',NULL),
 ('p07','i13', 204800,'wa_pay', 'wa_pay',   21,'WA-REF-O02','pay_SEED0002',NULL,'Paid through WhatsApp Pay','o02'),
 ('p08','i14',  50000,'cash',   'manual',   14,NULL,NULL,'RCT-2026-000002','Receipt document: cash',NULL),
 ('p09','i15', 118000,'card',   'manual',   27,'CARD-SEED-9',NULL,NULL,'Paid, later refunded in full',NULL),
 ('p10','i16', 300000,'upi',    'manual',   25,'UPI/SEED/0016',NULL,NULL,'Paid in full',NULL),
 ('p11','i17', 118000,'bank',   'manual',   19,'NEFT-SEED-17',NULL,NULL,'Paid before the return',NULL),
 ('p12','i19', 130000,'cheque', 'manual',   15,'CHQ-004411',NULL,NULL,'Over-payment: 30000 more than the total',NULL),
 ('p13','i20', 76582,'gateway', 'gateway',   7,'woo_SEED_7001','woo_SEED_7001',NULL,'WooCommerce gateway',NULL),
 ('p14','i21', 188564,'other',  'api',      11,'shopify-SEED-1001',NULL,NULL,'Recorded through the API',NULL),
 ('p15','i26',1000000000,'cheque','manual', 20,'CHQ-BIG-1',NULL,NULL,'First cheque of three',NULL),
 ('p16','i26',500000000,'bank', 'manual',   9,'RTGS-BIG-2',NULL,NULL,'Second transfer',NULL),
 ('p17','i03',  30000,'manual', 'manual',   40,NULL,NULL,NULL,'Advance taken before the invoice (reference only)',NULL);
-- p17 leaves the overdue invoice i03 part-paid: an overdue invoice with money on it.

INSERT INTO payments (org_id, invoice_id, amount_minor, currency, method, source, paid_at, reference, note, gateway_payment_id, recorded_by, receipt_number, wa_order_id, meta_json)
SELECT 15, pg_temp.k('i:' || p.ikey), p.amount, i.currency, p.method, p.source, now() - make_interval(days => p.ago), p.ref, p.note, p.gw, 63, p.rcpt,
       CASE WHEN p.okey IS NULL THEN NULL ELSE pg_temp.k('o:' || p.okey) END, jsonb_build_object('seed', 'interakt-store-edge', 'key', p.pkey)
  FROM p_src p JOIN invoices i ON i.org_id = 15 AND i.id = pg_temp.k('i:' || p.ikey)
 ORDER BY p.pkey;
INSERT INTO k SELECT 'pay:' || (meta_json->>'key'), id FROM payments WHERE org_id = 15 AND meta_json->>'seed' = 'interakt-store-edge';

-- a payment with no invoice at all (store order paid on the storefront, invoice not created yet)
INSERT INTO payments (org_id, invoice_id, amount_minor, currency, method, source, paid_at, reference, note, gateway_payment_id, recorded_by, wa_order_id, contact_id, meta_json) VALUES
  (15, NULL, 49900, 'INR', 'storefront', 'storefront', now() - interval '2 days', 'ORD-NOINV', 'Storefront payment with no invoice yet', 'pay_SEED_NOINV', NULL, pg_temp.k('o:o14'), pg_temp.k('c:rohan'), '{"seed":"interakt-store-edge","key":"p_noinv"}');

-- credit notes (issued) against paid and unpaid invoices
INSERT INTO credit_notes (org_id, invoice_id, series, credit_number, seq, status, reason, note, settlement, currency, currency_exponent, subtotal_minor, tax_minor, tax_added_minor, total_minor,
                          refunded_minor, issue_date, issued_at, created_by) VALUES
  (15, pg_temp.k('i:i17'), 'CRN-2026', 'CRN-2026-000001', 1, 'issued', 'return', 'Half the order returned', 'refund', 'INR', 2, 50000, 9000, 9000, 59000, 59000, current_date - 15, now() - interval '15 days', 63),
  (15, pg_temp.k('i:i18'), 'CRN-2026', 'CRN-2026-000002', 2, 'issued', 'billing_error', 'Billed the wrong item; whole invoice credited to the balance', 'balance', 'INR', 2, 50000, 9000, 9000, 59000, 0, current_date - 12, now() - interval '12 days', 63);
UPDATE invoice_number_sequences SET next_seq = 3 WHERE org_id = 15 AND series = 'CRN-2026';

-- refunds (negative rows that name the payment they return); the trigger refuses an over-refund
INSERT INTO payments (org_id, invoice_id, amount_minor, currency, method, source, paid_at, reference, note, recorded_by, kind, refund_of_id, meta_json)
SELECT 15, pg_temp.k('i:' || r.ikey), -r.amount, 'INR', r.method, 'manual', now() - make_interval(days => r.ago), r.ref, r.note, 63, 'refund', pg_temp.k('pay:' || r.parent),
       jsonb_build_object('seed', 'interakt-store-edge', 'key', r.pkey)
  FROM (VALUES ('r01','i15','p09',118000,'card',26,'REFUND-CARD-9','Full refund, customer cancelled'),
               ('r02','i16','p10',100000,'upi',23,'REFUND-UPI-16','Partial refund, item returned'),
               ('r03','i17','p11', 59000,'bank',15,'REFUND-NEFT-17','Refund for the credit note')) AS r(pkey, ikey, parent, amount, method, ago, ref, note);
INSERT INTO k SELECT 'pay:' || (meta_json->>'key'), id FROM payments WHERE org_id = 15 AND kind = 'refund' AND meta_json->>'seed' = 'interakt-store-edge';
-- the credit note on i18 changes the invoice's paid state without a payment: recompute it
SELECT invoice_refresh_payment_state(15, pg_temp.k('i:i18'), now());
-- a second, partial refund on the same payment (cumulative refunds stay within the amount)
INSERT INTO payments (org_id, invoice_id, amount_minor, currency, method, source, paid_at, reference, note, recorded_by, kind, refund_of_id, meta_json) VALUES
  (15, pg_temp.k('i:i16'), -50000, 'INR', 'upi', 'manual', now() - interval '20 days', 'REFUND-UPI-16B', 'Second partial refund on the same payment', 63, 'refund', pg_temp.k('pay:p10'), '{"seed":"interakt-store-edge","key":"r04"}');

-- void invoice must stay unpaid; credited_minor is bounded by the total (checked by the constraints above)

-- =====================================================================================================================================
-- 9. PAYMENT ATTEMPTS (pay-by-link) and the gateway connection
-- =====================================================================================================================================
INSERT INTO invoice_gateway_connections (org_id, provider, enabled, mode, webhook_secret_cipher, created_by) VALUES
  (15, 'hmac_generic', true, 'test', 'seed:cipher:not-a-real-secret', 63);
INSERT INTO k SELECT 'gw:1', id FROM invoice_gateway_connections WHERE org_id = 15 ORDER BY id DESC LIMIT 1;

INSERT INTO invoice_payment_attempts (org_id, invoice_id, connection_id, provider, amount_minor, currency, status, external_id, checkout_url, payment_id, expires_at, created_at) VALUES
  (15, pg_temp.k('i:i07'), pg_temp.k('gw:1'), 'hmac_generic', 217400, 'INR', 'pending',   'seed_att_001', 'https://pay.seed.example/c/seed_att_001', NULL, now() + interval '2 days', now() - interval '1 day'),
  (15, pg_temp.k('i:i03'), pg_temp.k('gw:1'), 'hmac_generic', 141600, 'INR', 'expired',   'seed_att_002', 'https://pay.seed.example/c/seed_att_002', NULL, now() - interval '5 days', now() - interval '12 days'),
  (15, pg_temp.k('i:i03'), pg_temp.k('gw:1'), 'hmac_generic', 141600, 'INR', 'failed',    'seed_att_003', 'https://pay.seed.example/c/seed_att_003', NULL, now() + interval '1 day', now() - interval '3 days'),
  (15, pg_temp.k('i:i09'), pg_temp.k('gw:1'), 'hmac_generic', 250000, 'USD', 'succeeded', 'seed_att_004', 'https://pay.seed.example/c/seed_att_004', pg_temp.k('pay:p05'), now() - interval '4 days', now() - interval '6 days'),
  (15, pg_temp.k('i:i02'), NULL,              'manual',        240000, 'INR', 'pending',   NULL,           NULL, NULL, NULL, now() - interval '2 days');

-- =====================================================================================================================================
-- 10. RECURRING INVOICES, store-to-invoice handoffs and the activity log
-- =====================================================================================================================================
INSERT INTO recurring_invoices (org_id, name, status, frequency, interval_n, start_date, end_date, max_runs, mode, send_channel, template, contact_id, company_id, owner_id, created_by,
                                next_index, next_run_date, run_count, failure_count, last_run_at) VALUES
  (15, 'SEED Monthly retainer (active)', 'active', 'month', 1, current_date - 70, NULL, NULL, 'issue_send', 'email',
   '{"buyerName":"SEED Textiles Pvt Ltd","currency":"INR","taxRegime":"gst","lines":[{"description":"Monthly retainer","qty":"1","unitPrice":"5000.00"}]}', NULL, pg_temp.k('co:textiles'), 63, 63, 3, current_date + 20, 3, 0, now() - interval '10 days'),
  (15, 'SEED Weekly subscription box (paused)', 'paused', 'week', 1, current_date - 30, NULL, NULL, 'draft', 'link',
   '{"buyerName":"Aarav Sharma","currency":"INR","lines":[{"description":"Weekly box","qty":"1","unitPrice":"799.00"}]}', pg_temp.k('c:aarav'), NULL, 63, 63, 4, current_date + 2, 4, 1, now() - interval '9 days'),
  (15, 'SEED Quarterly licence (ended: max runs reached)', 'ended', 'month', 3, current_date - 400, current_date - 30, 4, 'issue', 'whatsapp',
   '{"buyerName":"Zoë Müller-Åström 渡辺","currency":"INR","lines":[{"description":"Quarterly licence","qty":"1","unitPrice":"12000.00"}]}', pg_temp.k('c:zoe.muller'), NULL, 63, 63, 4, NULL, 4, 0, now() - interval '100 days'),
  (15, 'SEED Daily failing (every run failed)', 'active', 'day', 1, current_date - 3, current_date + 60, 90, 'issue_send', 'whatsapp',
   '{"buyerName":"No Phone Customer","currency":"INR","lines":[{"description":"Daily service","qty":"1","unitPrice":"99.00"}]}', NULL, NULL, 63, 63, 3, current_date + 1, 0, 3, now() - interval '1 day');
INSERT INTO k SELECT 'rec:' || row_number() OVER (ORDER BY id), id FROM recurring_invoices WHERE org_id = 15 AND name LIKE 'SEED %';

INSERT INTO recurring_invoice_runs (org_id, recurring_id, period_index, period_date, status, invoice_id, error) VALUES
  (15, pg_temp.k('rec:1'), 0, current_date - 70, 'created', NULL, NULL),
  (15, pg_temp.k('rec:1'), 1, current_date - 40, 'created', NULL, NULL),
  (15, pg_temp.k('rec:1'), 2, current_date - 10, 'created', NULL, NULL),
  (15, pg_temp.k('rec:2'), 0, current_date - 30, 'created', NULL, NULL),
  (15, pg_temp.k('rec:2'), 1, current_date - 23, 'failed',  NULL, 'The contact has no email address'),
  (15, pg_temp.k('rec:4'), 0, current_date - 3,  'failed',  NULL, 'whatsapp: recipient has no phone number'),
  (15, pg_temp.k('rec:4'), 1, current_date - 2,  'failed',  NULL, 'whatsapp: recipient has no phone number'),
  (15, pg_temp.k('rec:4'), 2, current_date - 1,  'failed',  NULL, 'whatsapp: recipient has no phone number');
-- tie one generated invoice to a run and mark the invoice's source
UPDATE invoices SET recurring_id = pg_temp.k('rec:1'), source = 'recurring' WHERE org_id = 15 AND id = pg_temp.k('i:i23');
UPDATE recurring_invoice_runs SET invoice_id = pg_temp.k('i:i23') WHERE org_id = 15 AND recurring_id = pg_temp.k('rec:1') AND period_index = 2;

INSERT INTO ecom_invoice_handoffs (org_id, source, delivery_id, topic, wa_order_id, invoice_id, outcome, reason) VALUES
  (15, 'woocommerce', 'seed-woo-delivery-1', 'order.updated', pg_temp.k('o:o11'), pg_temp.k('i:i20'), 'invoiced', NULL),
  (15, 'shopify',     'seed-shopify-delivery-1', 'orders/paid', pg_temp.k('o:o10'), pg_temp.k('i:i21'), 'invoiced', NULL),
  (15, 'shopify',     'seed-shopify-delivery-2', 'orders/paid', pg_temp.k('o:o10'), pg_temp.k('i:i21'), 'existing', 'invoice already exists for this order'),
  (15, 'woocommerce', 'seed-woo-delivery-2', 'order.created', pg_temp.k('o:o11'), NULL, 'skipped', 'order is not paid yet'),
  (15, 'shopify',     'seed-shopify-delivery-3', 'orders/create', pg_temp.k('o:o10'), NULL, 'pending', NULL);

INSERT INTO invoice_logs (org_id, invoice_id, event, detail, actor_kind, actor_user_id, created_at, meta_json)
SELECT 15, id, 'created', 'Invoice created', 'user', 63, created_at, '{"seed":true}' FROM invoices WHERE org_id = 15 AND meta_json->>'seed' = 'interakt-store-edge';
INSERT INTO invoice_logs (org_id, invoice_id, event, detail, actor_kind, actor_user_id, created_at, meta_json)
SELECT 15, id, 'issued', 'Issued as ' || invoice_number, 'user', 63, issued_at, '{"seed":true}' FROM invoices WHERE org_id = 15 AND meta_json->>'seed' = 'interakt-store-edge' AND status <> 'draft';
INSERT INTO invoice_logs (org_id, invoice_id, event, detail, actor_kind, created_at, meta_json)
SELECT 15, id, 'sent', 'Sent by ' || delivery_channel, 'system', sent_at, '{"seed":true}' FROM invoices WHERE org_id = 15 AND meta_json->>'seed' = 'interakt-store-edge' AND send_status = 'sent';
INSERT INTO invoice_logs (org_id, invoice_id, event, detail, actor_kind, created_at, meta_json)
SELECT 15, id, 'send_failed', send_error, 'system', now() - interval '2 days', '{"seed":true}' FROM invoices WHERE org_id = 15 AND meta_json->>'seed' = 'interakt-store-edge' AND send_status = 'failed';
INSERT INTO invoice_logs (org_id, invoice_id, event, detail, actor_kind, created_at, meta_json)
SELECT 15, id, 'viewed', 'Viewed by the customer', 'buyer', last_viewed_at, '{"seed":true}' FROM invoices WHERE org_id = 15 AND view_count > 0 AND meta_json->>'seed' = 'interakt-store-edge';
INSERT INTO invoice_logs (org_id, invoice_id, event, detail, actor_kind, actor_user_id, created_at, meta_json)
SELECT 15, id, 'voided', void_reason, 'user', 63, voided_at, '{"seed":true}' FROM invoices WHERE org_id = 15 AND status = 'void' AND meta_json->>'seed' = 'interakt-store-edge';
INSERT INTO invoice_logs (org_id, invoice_id, event, detail, actor_kind, created_at, meta_json)
SELECT 15, invoice_id, 'payment', 'Payment of ' || amount_minor || ' recorded (' || method || ')', 'system', paid_at, '{"seed":true}' FROM payments WHERE org_id = 15 AND kind = 'payment' AND invoice_id IS NOT NULL AND meta_json->>'seed' = 'interakt-store-edge';
INSERT INTO invoice_logs (org_id, invoice_id, event, detail, actor_kind, created_at, meta_json)
SELECT 15, invoice_id, 'refund', 'Refund of ' || (-amount_minor) || ' recorded', 'system', paid_at, '{"seed":true}' FROM payments WHERE org_id = 15 AND kind = 'refund' AND meta_json->>'seed' = 'interakt-store-edge';

-- =====================================================================================================================================
-- 11. FORMS (web forms): definitions, versions, submissions in every status, payments, funnel events
-- =====================================================================================================================================
CREATE FUNCTION pg_temp.fdef(p_title text, p_steps jsonb, p_payment jsonb DEFAULT '{}'::jsonb, p_consent_required boolean DEFAULT true) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1, 'title', p_title, 'description', '<p>' || p_title || ' (demo data)</p>', 'steps', p_steps, 'rules', '[]'::jsonb,
    'after', jsonb_build_object('tags', jsonb_build_array('Seed')),
    'theme', (SELECT draft_definition->'theme' FROM web_forms WHERE org_id = 15 AND id = 3),
    'consent', jsonb_build_object('enabled', p_consent_required, 'required', p_consent_required, 'text', 'I agree to be contacted about my request.', 'version', 1, 'marketing', false),
    'settings', jsonb_build_object('locale', 'en', 'submitLabel', 'Submit', 'successMode', 'message', 'successMessage', 'Thank you! We will be in touch.'),
    'mapping', '{}'::jsonb, 'payment', p_payment)
$$;

CREATE FUNCTION pg_temp.fld(p_id text, p_kind text, p_label text, p_required boolean DEFAULT false, p_extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', p_id, 'type', 'field', 'kind', p_kind, 'label', p_label, 'required', p_required, 'width', 'full') || p_extra
$$;

INSERT INTO web_forms (org_id, name, public_key, status, draft_definition, allowed_origins, captcha_mode, honeypot, notify, retention_days, owner_rule, rate_limits, created_by) VALUES
 (15, 'SEED Newsletter signup', 'SeedFormKey00000000001',  'draft',
  pg_temp.fdef('Join our newsletter', jsonb_build_array(jsonb_build_object('id','main','blocks', jsonb_build_array(
     pg_temp.fld('first_name','short_text','First name',false,'{"bind":{"object":"contact","property":"first_name"},"width":"half"}'),
     pg_temp.fld('email','email','Email address',true,'{"bind":{"object":"contact","property":"email"}}'),
     pg_temp.fld('topics','checkbox_group','Topics you care about',false,'{"options":[{"value":"offers","label":"Offers"},{"value":"launches","label":"New launches"},{"value":"events","label":"Events"}]}')))), '{}'::jsonb, true),
  ARRAY['https://seed-shop.example'], 'inherit', true, '{"owner":true,"emails":["alerts@seed.example"],"userIds":[]}', 365, '{"mode":"unassigned","userIds":[]}', '{}', 63),
 (15, 'SEED Product enquiry (every field kind)', 'SeedFormKey00000000002', 'draft',
  pg_temp.fdef('Product enquiry', jsonb_build_array(
    jsonb_build_object('id','about','blocks', jsonb_build_array(
      jsonb_build_object('id','h1','type','heading','text','About you','level',2),
      pg_temp.fld('name','short_text','Full name',true,'{"bind":{"object":"contact","property":"first_name"},"validation":{"minLen":2,"maxLen":80}}'),
      pg_temp.fld('email','email','Work email',true,'{"bind":{"object":"contact","property":"email"}}'),
      pg_temp.fld('phone','phone','Phone',false,'{"bind":{"object":"contact","property":"phone"}}'),
      pg_temp.fld('company','short_text','Company',false,'{"bind":{"object":"company","property":"name"}}'),
      jsonb_build_object('id','div1','type','divider'))),
    jsonb_build_object('id','need','blocks', jsonb_build_array(
      jsonb_build_object('id','p1','type','paragraph','html','<p>Tell us what you need.</p>'),
      pg_temp.fld('message','long_text','Your message',true,'{"validation":{"maxLen":2000}}'),
      pg_temp.fld('qty','number','Quantity',false,'{"validation":{"min":1,"max":10000}}'),
      pg_temp.fld('budget','currency','Budget',false,'{}'),
      pg_temp.fld('needed_by','date','Needed by',false,'{}'),
      pg_temp.fld('category','dropdown','Category',true,'{"options":[{"value":"apparel","label":"Apparel"},{"value":"electronics","label":"Electronics"},{"value":"other","label":"Other"}]}'),
      pg_temp.fld('contact_pref','radio','Preferred contact',true,'{"options":[{"value":"email","label":"Email"},{"value":"phone","label":"Phone"},{"value":"whatsapp","label":"WhatsApp"}]}'),
      pg_temp.fld('extras','checkbox_group','Extras',false,'{"options":[{"value":"gift","label":"Gift wrap"},{"value":"express","label":"Express shipping"}]}'),
      pg_temp.fld('newsletter','checkbox','Subscribe to the newsletter',false,'{}'),
      pg_temp.fld('rating','rating','How did you find us?',false,'{}'),
      pg_temp.fld('utm','hidden','Source',false,'{"hiddenSource":"utm_source"}')))), '{}'::jsonb, true),
  ARRAY['https://seed-shop.example','https://www.seed-shop.example'], 'on', true, jsonb_build_object('owner', true, 'emails', '[]'::jsonb, 'userIds', (SELECT jsonb_agg(uuid) FROM users WHERE org_id = 15 AND id IN (63, 64))), 90,
  jsonb_build_object('mode', 'round_robin', 'userIds', (SELECT jsonb_agg(uuid) FROM users WHERE org_id = 15 AND id IN (63, 64, 65))), '{"perIpPerMinute":5,"perFormPerMinute":60,"perContactPerHour":3}', 63),
 (15, 'SEED Event deposit (fixed payment)', 'SeedFormKey00000000003', 'draft',
  pg_temp.fdef('Reserve your seat', jsonb_build_array(jsonb_build_object('id','main','blocks', jsonb_build_array(
     pg_temp.fld('name','short_text','Name',true,'{"bind":{"object":"contact","property":"first_name"}}'),
     pg_temp.fld('email','email','Email',true,'{"bind":{"object":"contact","property":"email"}}')))),
     '{"enabled":true,"amountType":"fixed","amountMinor":49900,"currency":"INR","description":"Seat deposit"}', true),
  '{}', 'inherit', true, '{"owner":true,"emails":[],"userIds":[]}', 365, '{"mode":"unassigned","userIds":[]}', '{}', 63),
 (15, 'SEED Donation (pay what you want)', 'SeedFormKey00000000004', 'draft',
  pg_temp.fdef('Support us', jsonb_build_array(jsonb_build_object('id','main','blocks', jsonb_build_array(
     pg_temp.fld('email','email','Email',true,'{"bind":{"object":"contact","property":"email"}}'),
     pg_temp.fld('amount','currency','Amount',true,'{}')))),
     '{"enabled":true,"amountType":"pay_what_you_want","fieldId":"amount","minMinor":10000,"maxMinor":10000000,"currency":"INR","description":"Donation"}', false),
  '{}', 'off', false, '{"owner":false,"emails":["donations@seed.example"],"userIds":[]}', NULL, '{"mode":"unassigned","userIds":[]}', '{}', 63),
 (15, 'SEED Feedback survey (paused)', 'SeedFormKey00000000005', 'draft',
  pg_temp.fdef('Tell us how we did', jsonb_build_array(jsonb_build_object('id','main','blocks', jsonb_build_array(
     pg_temp.fld('rating','rating','Overall rating',true,'{}'),
     pg_temp.fld('comment','long_text','Comments',false,'{}')))), '{}', false),
  '{}', 'inherit', true, '{"owner":true,"emails":[],"userIds":[]}', 180, '{"mode":"unassigned","userIds":[]}', '{}', 63),
 (15, 'SEED Old campaign (archived)', 'SeedFormKey00000000006', 'draft',
  pg_temp.fdef('Old campaign', jsonb_build_array(jsonb_build_object('id','main','blocks', jsonb_build_array(
     pg_temp.fld('email','email','Email',true,'{}')))), '{}', false),
  '{}', 'inherit', true, '{"owner":true,"emails":[],"userIds":[]}', 365, '{"mode":"unassigned","userIds":[]}', '{}', 63),
 (15, 'SEED Draft: careers application', 'SeedFormKey00000000007', 'draft',
  pg_temp.fdef('Join the team', jsonb_build_array(jsonb_build_object('id','main','blocks', jsonb_build_array(
     pg_temp.fld('name','short_text','Name',true,'{}')))), '{}', false),
  '{}', 'inherit', true, '{"owner":true,"emails":[],"userIds":[]}', 3650, '{"mode":"unassigned","userIds":[]}', '{}', 63);
INSERT INTO k SELECT 'wf:' || n, id FROM (SELECT id, row_number() OVER (ORDER BY id) n FROM web_forms WHERE org_id = 15 AND name LIKE 'SEED %') x;

-- versions: the Newsletter form has two (an older one still referenced by old submissions), the others one
INSERT INTO web_form_versions (org_id, form_id, version, definition, published_by, published_at)
SELECT 15, id, 1, draft_definition || '{"title":"Join our newsletter (v1)"}', 63, now() - interval '60 days' FROM web_forms WHERE org_id = 15 AND name = 'SEED Newsletter signup';
INSERT INTO web_form_versions (org_id, form_id, version, definition, published_by, published_at)
SELECT 15, id, 2, draft_definition, 63, now() - interval '30 days' FROM web_forms WHERE org_id = 15 AND name = 'SEED Newsletter signup';
INSERT INTO web_form_versions (org_id, form_id, version, definition, published_by, published_at)
SELECT 15, id, 1, draft_definition, 63, now() - interval '20 days' FROM web_forms WHERE org_id = 15 AND name LIKE 'SEED %' AND name NOT IN ('SEED Newsletter signup', 'SEED Draft: careers application');
INSERT INTO k SELECT 'wv:' || form_id || ':' || version, id FROM web_form_versions WHERE org_id = 15 AND form_id IN (SELECT id FROM web_forms WHERE name LIKE 'SEED %');

UPDATE web_forms f SET status = CASE
    WHEN name = 'SEED Feedback survey (paused)' THEN 'paused' WHEN name = 'SEED Old campaign (archived)' THEN 'archived' ELSE 'published' END,
  published_version_id = (SELECT id FROM web_form_versions v WHERE v.org_id = 15 AND v.form_id = f.id ORDER BY version DESC LIMIT 1)
 WHERE org_id = 15 AND name LIKE 'SEED %' AND name <> 'SEED Draft: careers application';

-- submissions ---------------------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE ws_src (skey text, fidx int, ver int, status text, reason text, err text, answers jsonb, ckey text, utm jsonb, ref text, page text, ago numeric, spam int, consent boolean, erased boolean, purged boolean, dup boolean);
INSERT INTO ws_src VALUES
 -- Newsletter (form 1)
 ('s01',1,2,'created',NULL,NULL,'{"first_name":"Aarav","email":"aarav@example.com","topics":["offers","events"]}','c:aarav','{"utm_source":"instagram","utm_medium":"social","utm_campaign":"diwali"}','https://instagram.com','https://seed-shop.example/',2,0,true,false,false,false),
 ('s02',1,2,'updated',NULL,NULL,'{"first_name":"Priya","email":"priya@example.com","topics":["launches"]}','c:priya','{}',NULL,'https://seed-shop.example/blog',5,0,true,false,false,false),
 ('s03',1,2,'needs_review','no_contact_point',NULL,'{"first_name":"Anonymous","topics":["offers"]}',NULL,'{}',NULL,'https://seed-shop.example/',6,0,true,false,false,false),
 ('s04',1,2,'spam','spam_score',NULL,'{"first_name":"BUY NOW","email":"x@mailinator.example"}',NULL,'{"utm_source":"spam"}',NULL,'https://seed-shop.example/',7,92,false,false,false,false),
 ('s05',1,2,'failed','internal_error','relation "contacts" lock timeout while creating the contact','{"first_name":"Late","email":"late@seed.example"}',NULL,'{}',NULL,'https://seed-shop.example/',8,0,true,false,false,false),
 ('s06',1,2,'received',NULL,NULL,'{"email":"queued@seed.example"}',NULL,'{}',NULL,'https://seed-shop.example/',0.01,5,true,false,false,false),
 ('s07',1,1,'created',NULL,NULL,'{"first_name":"Old Version","email":"oldversion@seed.example"}',NULL,'{}',NULL,'https://seed-shop.example/',40,0,true,false,false,false),
 ('s08',1,2,'created',NULL,NULL,'{}','c:meera.nair','{}',NULL,NULL,50,0,true,true,true,false),
 -- Enquiry (form 2)
 ('s09',2,1,'created',NULL,NULL,'{"name":"Zoë Müller-Åström 渡辺","email":"zoe.muller@seed.example","phone":"+4915112345678","company":"Seed GmbH","message":"Need 500 units. Ünïcödé ✓ 🙂","qty":500,"budget":250000.5,"needed_by":"2026-12-01","category":"apparel","contact_pref":"whatsapp","extras":["gift","express"],"newsletter":true,"rating":5,"utm":"google"}','c:zoe.muller','{"utm_source":"google","utm_medium":"cpc","utm_term":"bulk tees"}','https://google.com','https://seed-shop.example/enquiry',3,0,true,false,false,false),
 ('s10',2,1,'needs_review','invalid_phone',NULL,'{"name":"Bad Phone","email":"badphone@seed.example","phone":"12345","message":"hi","category":"other","contact_pref":"phone"}',NULL,'{}',NULL,'https://seed-shop.example/enquiry',4,0,true,false,false,false),
 ('s11',2,1,'needs_review','plan_limit_reached',NULL,'{"name":"Over Limit","email":"limit@seed.example","message":"x","category":"other","contact_pref":"email"}',NULL,'{}',NULL,'https://seed-shop.example/enquiry',9,0,true,false,false,false),
 ('s12',2,1,'failed','submissions_cap','the form has reached its submission cap','{"name":"Capped","email":"capped@seed.example","message":"x","category":"other","contact_pref":"email"}',NULL,'{}',NULL,'https://seed-shop.example/enquiry',10,0,true,false,false,false),
 ('s13',2,1,'spam','too_fast',NULL,'{"name":"Bot","email":"bot@seed.example","message":"filled in 1 second","category":"other","contact_pref":"email"}',NULL,'{}',NULL,'https://seed-shop.example/enquiry',11,60,false,false,false,false),
 ('s14',2,1,'created',NULL,NULL,'{"name":"Minimum Answers","email":"minimal@seed.example","message":"Just the required fields","category":"electronics","contact_pref":"email"}',NULL,'{}',NULL,NULL,12,0,true,false,false,false),
 -- Event deposit (form 3): payment flows
 ('s15',3,1,'awaiting_payment',NULL,NULL,'{"name":"Meera Nair","email":"meera.nair@seed.example"}','c:meera.nair','{}',NULL,'https://seed-shop.example/event',1,0,true,false,false,false),
 ('s16',3,1,'paid',NULL,NULL,'{"name":"Aarav Sharma","email":"aarav@example.com"}','c:aarav','{}',NULL,'https://seed-shop.example/event',6,0,true,false,false,false),
 ('s17',3,1,'failed',NULL,'payment failed three times','{"name":"Declined Card","email":"declined@seed.example"}',NULL,'{}',NULL,'https://seed-shop.example/event',7,0,true,false,false,false),
 ('s18',3,1,'paid',NULL,NULL,'{"name":"Paid By Bank Transfer","email":"bank@seed.example"}',NULL,'{}',NULL,'https://seed-shop.example/event',8,0,true,false,false,false),
 ('s19',3,1,'paid',NULL,NULL,'{"name":"Paid Twice","email":"twice@seed.example"}',NULL,'{}',NULL,'https://seed-shop.example/event',9,0,true,false,false,true),
 ('s20',3,1,'awaiting_payment',NULL,NULL,'{"name":"Link Expired Then Retried","email":"retry@seed.example"}',NULL,'{}',NULL,'https://seed-shop.example/event',3,0,true,false,false,false),
 -- Donation (form 4)
 ('s21',4,1,'paid',NULL,NULL,'{"email":"donor@seed.example","amount":123.45}',NULL,'{}',NULL,NULL,4,0,false,false,false,false),
 ('s22',4,1,'awaiting_payment',NULL,NULL,'{"email":"pledge@seed.example","amount":100}',NULL,'{}',NULL,NULL,1,0,false,false,false,false),
 -- Paused feedback survey (form 5)
 ('s23',5,1,'created',NULL,NULL,'{"rating":4,"comment":"Great service"}',NULL,'{}',NULL,NULL,30,0,false,false,false,false),
 ('s24',5,1,'created',NULL,NULL,('{"rating":1,"comment":"' || repeat('Very long angry comment. ', 80) || '"}')::jsonb,NULL,'{}',NULL,NULL,31,0,false,false,false,false);

INSERT INTO web_form_submissions (org_id, form_id, version_id, idempotency_key, receipt_token, status, reason, error, answers, contact_id, utm, referrer, page_url, ip_hash, user_agent,
                                  consent, spam_score, answers_expires_at, payload_purged_at, erased_at, created_at, updated_at)
SELECT 15, pg_temp.k('wf:' || w.fidx), pg_temp.k('wv:' || pg_temp.k('wf:' || w.fidx) || ':' || w.ver), 'seed-idem-' || w.skey || '-0001', 'seedrcpt' || w.skey || md5(w.skey),
       w.status, w.reason, w.err, CASE WHEN w.erased THEN '{}'::jsonb ELSE w.answers END,
       CASE WHEN w.ckey IS NULL THEN NULL ELSE pg_temp.k(w.ckey) END, w.utm, w.ref, w.page, md5('ip' || w.skey), 'Mozilla/5.0 (Seed Browser)',
       CASE WHEN w.consent THEN '{"accepted":true,"version":1,"text":"I agree to be contacted about my request."}'::jsonb END, w.spam,
       now() + interval '300 days', CASE WHEN w.purged THEN now() - interval '1 day' END, CASE WHEN w.erased THEN now() - interval '2 days' END,
       now() - make_interval(secs => (w.ago * 86400)::int), now() - make_interval(secs => (w.ago * 86400)::int)
  FROM ws_src w;
INSERT INTO k SELECT 'ws:' || substr(idempotency_key, 11, 3), id FROM web_form_submissions WHERE org_id = 15 AND idempotency_key LIKE 'seed-idem-%';

-- bulk: 60 more created submissions on the Newsletter form over 30 days (analytics, pagination, search)
INSERT INTO web_form_submissions (org_id, form_id, version_id, idempotency_key, receipt_token, status, answers, utm, consent, spam_score, answers_expires_at, created_at, updated_at)
SELECT 15, pg_temp.k('wf:1'), pg_temp.k('wv:' || pg_temp.k('wf:1') || ':2'), 'seed-bulk-' || lpad(g::text, 4, '0'), 'seedbulk' || lpad(g::text, 4, '0') || md5(g::text),
       CASE WHEN g % 11 = 0 THEN 'needs_review' WHEN g % 17 = 0 THEN 'spam' WHEN g % 5 = 0 THEN 'updated' ELSE 'created' END,
       jsonb_build_object('first_name', 'Bulk' || g, 'email', 'bulk' || g || '@seed.example'),
       jsonb_build_object('utm_source', (ARRAY['instagram','google','newsletter','direct'])[1 + g % 4]),
       '{"accepted":true,"version":1}', CASE WHEN g % 17 = 0 THEN 80 ELSE 0 END, now() + interval '300 days',
       now() - make_interval(hours => g * 11), now() - make_interval(hours => g * 11)
  FROM generate_series(1, 60) g;
UPDATE web_form_submissions SET reason = CASE status WHEN 'needs_review' THEN 'no_contact_point' WHEN 'spam' THEN 'spam_score' END
 WHERE org_id = 15 AND idempotency_key LIKE 'seed-bulk-%' AND status IN ('needs_review', 'spam');

-- payment attempts behind the paid / awaiting submissions. Needs migration 20261117090000_forms_payments (the table and the
-- duplicate_payment column); a server that has not applied it yet skips this block and the submissions keep their status.
SELECT to_regclass('web_form_payments') IS NOT NULL AS has_form_payments \gset
\if :has_form_payments
INSERT INTO web_form_payments (org_id, submission_id, reference, gateway_slug, amount_minor, currency, status, settled_via, provider_ref, link_url, paid_at, expires_at, created_at) VALUES
 (15, pg_temp.k('ws:s15'), 'FRM-seed-0001', 'razorpay', 49900, 'INR', 'pending', NULL, NULL, 'https://rzp.seed.example/l/0001', NULL, now() + interval '2 days', now() - interval '1 day'),
 (15, pg_temp.k('ws:s16'), 'FRM-seed-0002', 'razorpay', 49900, 'INR', 'paid', 'gateway', 'pay_SEEDFORM02', 'https://rzp.seed.example/l/0002', now() - interval '6 days', now() - interval '4 days', now() - interval '6 days'),
 (15, pg_temp.k('ws:s17'), 'FRM-seed-0003', 'razorpay', 49900, 'INR', 'failed', NULL, 'pay_SEEDFORM03', 'https://rzp.seed.example/l/0003', NULL, now() - interval '5 days', now() - interval '7 days'),
 (15, pg_temp.k('ws:s18'), 'FRM-seed-0004', 'razorpay', 49900, 'INR', 'expired', NULL, NULL, 'https://rzp.seed.example/l/0004', NULL, now() - interval '6 days', now() - interval '8 days'),
 (15, pg_temp.k('ws:s18'), 'FRM-seed-0005', 'razorpay', 49900, 'INR', 'paid', 'manual', NULL, NULL, now() - interval '7 days', now() + interval '1 day', now() - interval '7 days'),
 (15, pg_temp.k('ws:s19'), 'FRM-seed-0006', 'razorpay', 49900, 'INR', 'paid', 'gateway', 'pay_SEEDFORM06', 'https://rzp.seed.example/l/0006', now() - interval '9 days', now() - interval '7 days', now() - interval '9 days'),
 (15, pg_temp.k('ws:s19'), 'FRM-seed-0007', 'razorpay', 49900, 'INR', 'paid', 'gateway', 'pay_SEEDFORM07', 'https://rzp.seed.example/l/0007', now() - interval '9 days' + interval '3 minutes', now() - interval '7 days', now() - interval '9 days'),
 (15, pg_temp.k('ws:s20'), 'FRM-seed-0008', 'razorpay', 49900, 'INR', 'expired', NULL, NULL, 'https://rzp.seed.example/l/0008', NULL, now() - interval '1 day', now() - interval '3 days'),
 (15, pg_temp.k('ws:s20'), 'FRM-seed-0009', 'razorpay', 49900, 'INR', 'pending', NULL, NULL, 'https://rzp.seed.example/l/0009', NULL, now() + interval '2 days', now() - interval '1 hour'),
 (15, pg_temp.k('ws:s21'), 'FRM-seed-0010', 'stripe', 12345, 'INR', 'paid', 'gateway', 'pi_SEEDFORM10', NULL, now() - interval '4 days', now() - interval '2 days', now() - interval '4 days'),
 (15, pg_temp.k('ws:s22'), 'FRM-seed-0011', 'stripe', 10000, 'INR', 'pending', NULL, NULL, 'https://stripe.seed.example/p/0011', NULL, now() + interval '1 day', now() - interval '1 day');
UPDATE web_form_submissions SET duplicate_payment = true WHERE org_id = 15 AND id = pg_temp.k('ws:s19');
\else
  \echo NOTE: web_form_payments does not exist on this server (forms_payments migration not applied): form payment attempts skipped
\endif

-- funnel events: views > starts > steps > submits > completes, with drop-offs, per form
INSERT INTO web_form_events (org_id, form_id, version_id, visit_id, kind, step_index, created_at)
SELECT 15, pg_temp.k('wf:' || f), pg_temp.k('wv:' || pg_temp.k('wf:' || f) || ':' || CASE WHEN f = 1 THEN 2 ELSE 1 END), 'seedvisit' || f || '-' || lpad(g::text, 3, '0'), e.kind, e.step,
       now() - make_interval(hours => g * 7) + make_interval(secs => e.off)
  FROM generate_series(1, 4) f, generate_series(1, 80) g,
       LATERAL (VALUES ('view', NULL::int, 0, true), ('start', NULL, 20, g % 10 < 6), ('step', 0, 40, g % 10 < 5 AND f = 2), ('submit', NULL, 90, g % 10 < 4), ('complete', NULL, 92, g % 10 < 3)) AS e(kind, step, off, keep)
 WHERE e.keep;
INSERT INTO web_form_usage_monthly (org_id, period, spam_blocked, ai_generations) VALUES
  (15, date_trunc('month', current_date)::date, 14, 3),
  (15, (date_trunc('month', current_date) - interval '1 month')::date, 0, 0),
  (15, (date_trunc('month', current_date) - interval '2 months')::date, 211, 40)
ON CONFLICT (org_id, period) DO UPDATE SET spam_blocked = EXCLUDED.spam_blocked, ai_generations = EXCLUDED.ai_generations;

-- =====================================================================================================================================
-- 12. FORMS (WhatsApp Flows forms) and their submissions
-- =====================================================================================================================================
INSERT INTO wa_forms (org_id, user_id, title, purpose, slug, audience_type, submission_cap, cap_reached_note, send_button_label, thank_you_note, definition_json, status, meta_flow_id,
                      published_at, publish_error, submission_count) VALUES
 (15, 63, 'SEED Lead capture', 'Collect leads from WhatsApp conversations', 'seed-lead-capture', 'lead_capture', 0, NULL, 'Send', 'Thanks! We will call you shortly.',
  '{"screens":[{"id":"DETAILS","title":"Your details","fields":[{"type":"text","name":"full_name","label":"Full name","required":true},{"type":"text","name":"phone","label":"Phone","required":true},{"type":"dropdown","name":"interest","label":"Interested in","required":true,"options":[{"id":"apparel","title":"Apparel"},{"id":"electronics","title":"Electronics"}]}]}]}',
  'published', 'FLOW-SEED-0001', now() - interval '25 days', NULL, 0),
 (15, 63, 'SEED Feedback (cap reached at 3)', 'Customer feedback with a response cap', 'seed-feedback-capped', 'survey', 3, 'This form is closed: we received all the responses we needed.', 'Submit', NULL,
  '{"screens":[{"id":"RATE","title":"Rate us","fields":[{"type":"radio","name":"rating","label":"Rating","required":true,"options":[{"id":"5","title":"Great"},{"id":"3","title":"OK"},{"id":"1","title":"Poor"}]},{"type":"textarea","name":"comment","label":"Comment","required":false}]}]}',
  'published', 'FLOW-SEED-0002', now() - interval '14 days', NULL, 0),
 (15, 63, 'SEED Draft with a publish error', 'Never published: Meta rejected the Flow', 'seed-draft-publish-error', 'lead_capture', 0, NULL, 'Send', NULL,
  '{"screens":[{"id":"ONE","title":"Step one","fields":[{"type":"text","name":"name","label":"Name","required":true}]}]}',
  'draft', NULL, NULL, 'Flow JSON invalid: screen ONE has no footer button', 0),
 (15, 63, 'SEED Appointment booking 📅 with a very long title that keeps going to test truncation in lists and cards', NULL, 'seed-appointment-booking', 'appointment', 0, NULL, 'Book', 'Booked! See you soon.',
  '{"screens":[{"id":"WHEN","title":"When","fields":[{"type":"date","name":"day","label":"Day","required":true},{"type":"dropdown","name":"slot","label":"Slot","required":true,"options":[{"id":"am","title":"Morning"},{"id":"pm","title":"Afternoon"}]}]},{"id":"WHO","title":"Who","fields":[{"type":"text","name":"name","label":"Name","required":true}]}]}',
  'published', 'FLOW-SEED-0004', now() - interval '3 days', NULL, 0),
 (15, NULL, 'SEED Empty draft (no purpose, no definition fields)', NULL, 'seed-empty-draft', 'lead_capture', 0, NULL, 'Send', NULL, '{"screens":[{"id":"ONE","title":"Untitled","fields":[]}]}', 'draft', NULL, NULL, NULL, 0);
INSERT INTO k SELECT 'waf:' || slug, id FROM wa_forms WHERE org_id = 15 AND slug LIKE 'seed-%';

INSERT INTO wa_form_submissions (org_id, form_id, contact_id, flow_token, caller_phone, answers_json, meta_payload, submitted_at, created_at) VALUES
 (15, pg_temp.k('waf:seed-lead-capture'), pg_temp.k('c:aarav'), 'seed-token-001', '+919812345678', '{"full_name":"Aarav Sharma","phone":"+919812345678","interest":"apparel"}', '{"flow_token":"seed-token-001","action":"data_exchange"}', now() - interval '20 days', now() - interval '20 days'),
 (15, pg_temp.k('waf:seed-lead-capture'), NULL, 'seed-token-002', '+919000000001', '{"full_name":"Unknown Lead","phone":"+919000000001","interest":"electronics"}', '{}', now() - interval '10 days', now() - interval '10 days'),
 (15, pg_temp.k('waf:seed-lead-capture'), pg_temp.k('c:priya'), 'seed-token-003', '+919898765432', '{"full_name":"Priya Patel","phone":"+919898765432","interest":"apparel"}', '{}', NULL, now() - interval '2 days'),
 (15, pg_temp.k('waf:seed-lead-capture'), NULL, 'seed-token-004', NULL, NULL, NULL, NULL, now() - interval '1 day'),
 (15, pg_temp.k('waf:seed-feedback-capped'), pg_temp.k('c:meera.nair'), 'seed-token-005', '+919811100001', '{"rating":"5","comment":"Loved it 🙂"}', '{}', now() - interval '12 days', now() - interval '12 days'),
 (15, pg_temp.k('waf:seed-feedback-capped'), pg_temp.k('c:rohan'), 'seed-token-006', '+919811100002', '{"rating":"1","comment":""}', '{}', now() - interval '11 days', now() - interval '11 days'),
 (15, pg_temp.k('waf:seed-feedback-capped'), NULL, 'seed-token-007', '+919811100003', '{"rating":"3"}', '{}', now() - interval '9 days', now() - interval '9 days'),
 (15, pg_temp.k('waf:seed-appointment-booking'), pg_temp.k('c:zoe.muller'), 'seed-token-008', '+4915112345678', '{"day":"2026-11-02","slot":"pm","name":"Zoë Müller-Åström 渡辺"}', '{}', now() - interval '1 day', now() - interval '1 day');
UPDATE wa_forms f SET submission_count = (SELECT count(*) FROM wa_form_submissions s WHERE s.org_id = 15 AND s.form_id = f.id AND s.submitted_at IS NOT NULL)
 WHERE org_id = 15 AND slug LIKE 'seed-%';

-- =====================================================================================================================================
-- 13. Sanity report, then COMMIT only when asked with -v commit=1
-- =====================================================================================================================================
SELECT 'products' AS what, count(*) FROM wa_products WHERE org_id = 15 AND sku LIKE 'SEED-%'
UNION ALL SELECT 'orders', count(*) FROM wa_orders WHERE org_id = 15 AND meta_json->>'seed' = 'interakt-store-edge'
UNION ALL SELECT 'invoices', count(*) FROM invoices WHERE org_id = 15 AND meta_json->>'seed' = 'interakt-store-edge'
UNION ALL SELECT 'payments+refunds', count(*) FROM payments WHERE org_id = 15 AND meta_json->>'seed' = 'interakt-store-edge'
UNION ALL SELECT 'web forms', count(*) FROM web_forms WHERE org_id = 15 AND name LIKE 'SEED %'
UNION ALL SELECT 'web submissions', count(*) FROM web_form_submissions WHERE org_id = 15 AND (idempotency_key LIKE 'seed-idem-%' OR idempotency_key LIKE 'seed-bulk-%')
UNION ALL SELECT 'wa forms', count(*) FROM wa_forms WHERE org_id = 15 AND slug LIKE 'seed-%';
SELECT i.meta_json->>'key' AS inv, i.invoice_number, i.status, i.payment_status, i.currency, i.total_minor, i.paid_minor, i.refunded_minor, i.credited_minor
  FROM invoices i WHERE i.org_id = 15 AND i.meta_json->>'seed' = 'interakt-store-edge' ORDER BY i.id;

\if :{?commit}
  COMMIT;
  \echo COMMITTED
\else
  ROLLBACK;
  \echo ROLLED BACK (dry run): pass -v commit=1 to keep the data
\endif
