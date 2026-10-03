-- Why this migration exists: the provider cards in Reference read "Free, no key — out-of-box default. 50k req/day per IP
-- with admin email." and so on; the first seed paraphrased them. This puts Reference's descriptions on the five rows, and
-- only on a row that still holds the paraphrase, so a description an operator changed by hand is left alone.
-- Rollback: UPDATE the five rows back to the text in 20261003090000_i18n_registry_seed.sql.

UPDATE translation_providers SET description = 'Free, no key — out-of-box default. 50k req/day per IP with admin email.'
  WHERE slug = 'mymemory' AND description = 'Free, no key needed. A shared daily quota applies; adding a contact email raises it.';
UPDATE translation_providers SET description = 'Best quality, free, but unofficial endpoint — may break without notice.'
  WHERE slug = 'google_gtx' AND description = 'Good quality at no cost, but it is an unofficial endpoint and may stop working without notice.';
UPDATE translation_providers SET description = 'Open-source, self-hostable via Docker. No third-party data leak.'
  WHERE slug = 'libretranslate' AND description = 'Self-hosted or hosted open-source engine. Text stays on your own server when you host it.';
UPDATE translation_providers SET description = 'Premium quality for European languages. Free tier 500k chars/month.'
  WHERE slug = 'deepl' AND description = 'Official paid API with premium quality for European languages. Needs an API key.';
UPDATE translation_providers SET description = 'Official Google Translate API. Paid: ~$20 per 1M characters.'
  WHERE slug = 'google_cloud' AND description = 'Official Google Cloud Translation API, billed per character. Needs an API key.';
