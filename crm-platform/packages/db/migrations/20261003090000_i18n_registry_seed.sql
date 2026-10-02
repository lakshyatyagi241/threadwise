-- i18n: registry seed, single-default invariant, workspace permission keys
-- Why this migration exists: the ported tables ship empty, but a fresh install must offer the 21 UI languages and the
-- five translation providers from the first request (TW-I18N-007, TW-I18N-014), and the "exactly one default provider"
-- rule has to be a database fact rather than a transaction convention (TW-I18N-017 port note). Seeds use
-- ON CONFLICT DO NOTHING so re-running never overwrites an operator's edits (Reference's upsert did).

INSERT INTO languages (code, name, native_name, direction, sort_order) VALUES
  ('en',    'English',               'English',           'ltr',  1),
  ('es',    'Spanish',               'Español',           'ltr',  2),
  ('hi',    'Hindi',                 'हिन्दी',              'ltr',  3),
  ('ar',    'Arabic',                'العربية',           'rtl',  4),
  ('pt',    'Portuguese',            'Português',         'ltr',  5),
  ('ru',    'Russian',               'Русский',           'ltr',  6),
  ('ja',    'Japanese',              '日本語',             'ltr',  7),
  ('de',    'German',                'Deutsch',           'ltr',  8),
  ('fr',    'French',                'Français',          'ltr',  9),
  ('it',    'Italian',               'Italiano',          'ltr', 10),
  ('ko',    'Korean',                '한국어',             'ltr', 11),
  ('zh-CN', 'Chinese (Simplified)',  '简体中文',           'ltr', 12),
  ('tr',    'Turkish',               'Türkçe',            'ltr', 13),
  ('id',    'Indonesian',            'Bahasa Indonesia',  'ltr', 14),
  ('vi',    'Vietnamese',            'Tiếng Việt',        'ltr', 15),
  ('th',    'Thai',                  'ไทย',               'ltr', 16),
  ('pl',    'Polish',                'Polski',            'ltr', 17),
  ('nl',    'Dutch',                 'Nederlands',        'ltr', 18),
  ('ur',    'Urdu',                  'اردو',              'rtl', 19),
  ('he',    'Hebrew',                'עברית',             'rtl', 20),
  ('bn',    'Bengali',               'বাংলা',              'ltr', 21)
ON CONFLICT (code) DO NOTHING;

-- MyMemory is the default and, with Google (free), active out of the box so translation works with zero setup.
INSERT INTO translation_providers (slug, name, description, is_active, is_default, sort_order) VALUES
  ('mymemory',       'MyMemory',      'Free, no key needed. A shared daily quota applies; adding a contact email raises it.', true,  true,  1),
  ('google_gtx',     'Google (free)', 'Good quality at no cost, but it is an unofficial endpoint and may stop working without notice.', true,  false, 2),
  ('libretranslate', 'LibreTranslate','Self-hosted or hosted open-source engine. Text stays on your own server when you host it.', false, false, 3),
  ('deepl',          'DeepL',         'Official paid API with premium quality for European languages. Needs an API key.',     false, false, 4),
  ('google_cloud',   'Google Cloud',  'Official Google Cloud Translation API, billed per character. Needs an API key.',       false, false, 5)
ON CONFLICT (slug) DO NOTHING;

-- At most one default provider, enforced by the database.
CREATE UNIQUE INDEX uq_translation_providers_single_default ON translation_providers (is_default) WHERE is_default;

-- Workspace-facing keys: the Account translation tab (TW-I18N-035). Operator endpoints are guarded by the operator role.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('i18n.translation_settings.read',   'View translation settings',   'localization', false),
  ('i18n.translation_settings.update', 'Change translation settings', 'localization', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;
