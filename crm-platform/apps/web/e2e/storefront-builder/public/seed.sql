-- Test data of the public shop e2e: one org, eight shops (one per theme), 60 products, a coupon. Re-runnable.
-- Run: docker exec -i crm-postgres psql -U crm -d crm_commerce -v ON_ERROR_STOP=1 < seed.sql   (database crm_commerce only)
\set ON_ERROR_STOP on

INSERT INTO organizations (slug, name) VALUES ('pubshop-e2e', 'Public Shop E2E')
ON CONFLICT (slug) DO NOTHING;

DO $$
DECLARE
  oid bigint := (SELECT id FROM organizations WHERE slug = 'pubshop-e2e');
  t text;
  sid bigint;
BEGIN
  PERFORM set_config('app.org_id', oid::text, true);
  DELETE FROM wa_orders WHERE org_id = oid;
  DELETE FROM wa_coupons WHERE org_id = oid;
  DELETE FROM wa_product_reviews WHERE org_id = oid;
  DELETE FROM wa_products WHERE org_id = oid;
  DELETE FROM wa_storefronts WHERE org_id = oid;

  FOREACH t IN ARRAY ARRAY['aurora','meridian','verdure','bazaar','noir','kraft','mercato','studio'] LOOP
    INSERT INTO wa_storefronts (org_id, shop_name, slug, theme_key, enabled, currency_code, shipping_json, settings_json, payment_provider, payment_config_json)
    VALUES (
      oid, initcap(t) || ' Goods', 'sf-' || t, t, true, 'INR',
      '{"flat_minor": 5000, "free_above_minor": 50000, "note": "2-5 business days · Tracked"}',
      CASE WHEN t = 'meridian'
        THEN '{"hero_text": "Objects for a <em>slower</em> day", "footer_text": "Made by hand in small batches"}'::jsonb
        ELSE '{"hero_text": "", "footer_text": ""}'::jsonb END,
      CASE WHEN t = 'bazaar' THEN 'upi' ELSE NULL END,
      CASE WHEN t = 'bazaar' THEN '{"handle": "shop@upi"}'::jsonb ELSE NULL END
    );
  END LOOP;

  INSERT INTO wa_products (org_id, name, slug, description, body_html, price_minor, compare_price_minor, category, status, in_stock, stock_qty, sort_order, image_url, gallery_json, sku, tags_json, weight_grams, brand, created_at)
  SELECT oid,
    (ARRAY['Linen Shirt','Clay Mug','Canvas Tote','Soy Candle','Wool Scarf','Brass Lamp','Oak Tray','Silk Cap'])[1 + (g % 8)] || ' ' || g,
    'item-' || g,
    'A well made everyday object, number ' || g || '.',
    CASE WHEN g = 1 THEN '<p>Hand finished <strong>linen</strong> shirt.</p><ul><li>Pre-washed</li><li>Pearl buttons</li></ul><script>alert(1)</script>' ELSE NULL END,
    (g * 1000 + 9900),
    CASE WHEN g % 5 = 0 THEN (g * 1000 + 9900) * 14 / 10 ELSE NULL END,
    (ARRAY['Tops','Home','Bags','Decor'])[1 + (g % 4)],
    'active', true,
    CASE WHEN g IN (2, 3) THEN 3 WHEN g % 7 = 0 THEN 10 ELSE NULL END,
    g,
    'data:image/svg+xml;utf8,' || replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="hsl(' || (g * 37 % 360) || ',35%,72%)"/><circle cx="200" cy="200" r="90" fill="hsl(' || (g * 37 % 360) || ',40%,45%)"/></svg>', '#', '%23'),
    CASE WHEN g = 1 THEN '["data:image/svg+xml;utf8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 400 400%27%3E%3Crect width=%27400%27 height=%27400%27 fill=%27%23c9b894%27/%3E%3C/svg%3E"]'::jsonb ELSE NULL END,
    'SKU-' || g,
    CASE WHEN g = 1 THEN '["linen","summer"]'::jsonb ELSE NULL END,
    CASE WHEN g = 1 THEN 250 ELSE NULL END,
    CASE WHEN g = 1 THEN 'Acme' ELSE NULL END,
    now() - (g || ' days')::interval
  FROM generate_series(1, 60) g;

  INSERT INTO wa_coupons (org_id, code, type, amount, active, max_discount_minor)
  VALUES (oid, 'SAVE10', 'percent', 10, true, 50000), (oid, 'SHIPFREE', 'flat', 0, true, NULL);
  UPDATE wa_coupons SET free_shipping = true WHERE org_id = oid AND code = 'SHIPFREE';
END $$;

SELECT slug, theme_key FROM wa_storefronts WHERE org_id = (SELECT id FROM organizations WHERE slug = 'pubshop-e2e') ORDER BY id;
