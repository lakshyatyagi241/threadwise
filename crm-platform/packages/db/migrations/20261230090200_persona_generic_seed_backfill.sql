-- persona profiles: the `generic` persona and the backfill of every existing workspace onto it (docs/specs/persona-profiles.md section 10).
-- Why this migration exists: Hard Rule 1 (no feature lost or changed). `generic` shows every module with today's wording, so a workspace
-- that exists today must land on it with no visible change, and so must every workspace created from now on until it picks another.
--
--   1. seed `generic` (a system persona that cannot be archived) and its version 1, the document `GENERIC_PERSONA_DEFINITION` of
--      @crm/contracts (a test compares the two, so they cannot drift);
--   2. one `workspace_persona` row per existing organization: `generic`, solo mode OFF, onboarding marked done so no flow is ever
--      shown to a workspace that signed up before there was one.
--
-- Idempotent (ON CONFLICT DO NOTHING) and batched by organization id, so a rerun or a huge table is harmless. A workspace created
-- while this deploys has no row until its provisioning inserts one; the API reads a missing row as `generic` (nothing is hidden).
SELECT set_config('app.privileged', 'on', true);

INSERT INTO personas (key, status, is_system, sort_order, current_version)
VALUES ('generic', 'active', true, 0, 1)
ON CONFLICT (key) DO NOTHING;

INSERT INTO persona_versions (persona_id, version, status, definition, compiled, changes, note, published_at)
SELECT p.id, 1, 'published',
       '{
          "schemaVersion": 1,
          "label": { "en": "Generic" },
          "summary": { "en": "Everything, with the wording the product uses today." },
          "icon": "layers",
          "teamSizes": [],
          "vocabulary": { "nouns": {}, "phrases": {} },
          "modules": { "default": "show", "ids": {} },
          "presets": { "addons": [], "bookingTypes": [], "lifecycleStages": [], "pipelines": [], "templates": [], "settings": {} },
          "checklist": []
        }'::jsonb,
       '{}'::jsonb, '[]'::jsonb,
       'Initial version: the product as it is today, nothing hidden.', now()
FROM personas p
WHERE p.key = 'generic'
ON CONFLICT (persona_id, version) DO NOTHING;

DO $$
DECLARE
  last_id  bigint := 0;
  batch_max bigint;
BEGIN
  LOOP
    SELECT max(id) INTO batch_max
      FROM (SELECT id FROM organizations WHERE id > last_id ORDER BY id LIMIT 1000) b;
    EXIT WHEN batch_max IS NULL;

    INSERT INTO workspace_persona (org_id, persona_key, persona_version, solo_ui, onboarding)
    SELECT o.id, 'generic', 1, 'off', jsonb_build_object('completedAt', now(), 'backfilled', true)
      FROM organizations o
     WHERE o.id > last_id AND o.id <= batch_max
    ON CONFLICT (org_id) DO NOTHING;

    last_id := batch_max;
  END LOOP;
END $$;
