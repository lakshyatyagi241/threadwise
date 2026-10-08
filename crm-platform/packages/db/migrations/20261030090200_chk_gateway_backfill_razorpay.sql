-- chk: copy every shop's own Razorpay keys (`wa_storefronts.payment_config_json`, provider `razorpay_api`) into the shared gateway
-- store as a per-shop override, so nothing breaks when the checkout starts reading `wa_merchant_gateways` first.
--
-- The secrets are already encrypted field by field by the application (the key id is plain, the secret and the webhook secret are
-- ciphertext); SQL has no key and must not have one. They are therefore carried over as they are inside `meta.legacy` and
-- `credentials` stays NULL. The resolver reads that shape, and the first save of the row from the gateway screen rewrites it as the
-- usual single encrypted envelope and drops `meta.legacy`.
--
-- Idempotent: a shop that already has a razorpay row is left alone. The old column keeps its value (the resolver still falls back to
-- it, and the storefront settings screen still writes it and mirrors it into this row).

SELECT set_config('app.privileged', 'on', true);

INSERT INTO wa_merchant_gateways (org_id, storefront_id, slug, credentials, mode, active, sort_order, meta)
SELECT s.org_id,
       s.id,
       'razorpay',
       NULL,
       'live',
       true,
       0,
       jsonb_build_object(
         'migratedFromStorefront', true,
         'legacy', jsonb_strip_nulls(jsonb_build_object(
           'key_id', s.payment_config_json ->> 'key_id',
           'key_secret', s.payment_config_json ->> 'key_secret',
           'webhook_secret', s.payment_config_json ->> 'webhook_secret'
         ))
       )
FROM wa_storefronts s
WHERE s.payment_provider = 'razorpay_api'
  AND coalesce(s.payment_config_json ->> 'key_id', '') <> ''
  AND coalesce(s.payment_config_json ->> 'key_secret', '') <> ''
ON CONFLICT (org_id, storefront_id, slug) DO NOTHING;
