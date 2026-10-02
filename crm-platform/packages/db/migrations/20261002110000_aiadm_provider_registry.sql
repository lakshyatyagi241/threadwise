-- aiadm: the provider registry, the ledger's guard rails and the capability keys of the AI keys domain.
-- Why this migration exists (WD-AIADM-001, 003, 006, 008, 016): the schema migration created the three tables
-- empty. WaDesk created a provider row the first time an admin opened the page (a GET that wrote); here the 22
-- rows are seeded once, so reading is side-effect free and the sort order has no ties. `key_last4` lets a screen say
-- which key is saved without ever decrypting it. The ledger gets CHECKs so a bad caller cannot write a negative
-- count or an unknown payer. The three capability keys are for the workspace screens; the platform screens are
-- guarded by the operator role, not by these.

ALTER TABLE admin_ai_keys ADD COLUMN key_last4 text;
ALTER TABLE ai_provider_keys ADD COLUMN key_last4 text;

ALTER TABLE ai_token_usage
  ADD CONSTRAINT chk_ai_token_usage_billed_against CHECK (billed_against IN ('admin', 'workspace')),
  ADD CONSTRAINT chk_ai_token_usage_tokens CHECK (
    prompt_tokens >= 0 AND completion_tokens >= 0 AND total_tokens >= 0
  );

-- admin_ai_keys accepts writes only under the privileged flag (an operator table), the migration included.
SELECT set_config('app.privileged', 'on', true);

-- Collision-free order, language models first and voice vendors last. Rows that exist are never touched, so a
-- re-run (or a key already pasted) is safe: this only fills gaps.
INSERT INTO admin_ai_keys (provider, name, default_model, extra_config, is_active, sort_order) VALUES
  ('openai',      'OpenAI',          'gpt-5.4-mini',         '{}',  false, 1),
  ('anthropic',   'Anthropic',       'claude-opus-4-8',      '{}',  false, 2),
  ('gemini',      'Google Gemini',   'gemini-3.5-flash',     '{}',  false, 3),
  ('mistral',     'Mistral',         'mistral-large-latest', '{}',  false, 4),
  ('openrouter',  'OpenRouter',      NULL,                   '{}',  false, 5),
  ('deepseek',    'DeepSeek',        NULL,                   '{}',  false, 6),
  ('xai',         'xAI (Grok)',      NULL,                   '{}',  false, 7),
  ('perplexity',  'Perplexity',      NULL,                   '{}',  false, 8),
  ('groq',        'Groq',            NULL,                   '{}',  false, 9),
  ('qwen',        'Alibaba Qwen',    NULL,                   '{}',  false, 10),
  ('moonshot',    'Moonshot (Kimi)', NULL,                   '{}',  false, 11),
  ('zai',         'Z.ai (GLM)',      NULL,                   '{}',  false, 12),
  ('cohere',      'Cohere',          NULL,                   '{}',  false, 13),
  ('nvidia',      'NVIDIA',          NULL,                   '{}',  false, 14),
  ('llama',       'Meta Llama',      NULL,                   '{}',  false, 15),
  ('huggingface', 'Hugging Face',    NULL,                   '{}',  false, 16),
  ('baidu',       'Baidu (Ernie)',   NULL,                   '{}',  false, 17),
  ('ai21',        'AI21 (Jamba)',    NULL,                   '{}',  false, 18),
  ('reka',        'Reka',            NULL,                   '{}',  false, 19),
  ('yi',          '01.AI (Yi)',      NULL,                   '{}',  false, 20),
  ('elevenlabs',  'ElevenLabs',      'eleven_v3',            '{}',  false, 21),
  ('deepgram',    'Deepgram',        'nova-2',               '{}',  false, 22)
ON CONFLICT (provider) DO NOTHING;

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('aiadm.keys.read',   'View the workspace AI provider keys', 'ai', false),
  ('aiadm.keys.manage', 'Add, switch and remove the workspace AI provider keys', 'ai', false),
  ('aiadm.usage.read',  'View AI usage and the monthly token cap', 'ai', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the
-- new keys by unlocking, granting and relocking here, as the contacts migration does. New organizations get every key
-- in permission_defs when they are provisioned.
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('aiadm.keys.read'),
    ('aiadm.keys.manage'),
    ('aiadm.usage.read')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
