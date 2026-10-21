-- Edition personas (BL-383, docs/specs/teams-unification.md 5.6): three catalog personas that make the one product look like a chat product,
-- a sales CRM, or both. DATA only: each is a published version 1 in the persona catalog, seeded through the P0 tables. No workspace is moved to
-- them (every workspace stays on generic); an operator attaches one (docs/api/teams-packaging.md). The documents are the constants
-- of packages/contracts/src/persona/editions.ts and a test compares the two, so they cannot drift.
-- Expand-only: inserts only, idempotent (ON CONFLICT DO NOTHING).
SELECT set_config('app.privileged', 'on', true);

INSERT INTO personas (key, status, is_system, sort_order, current_version)
VALUES ('chat_team', 'active', false, 1, 1)
ON CONFLICT (key) DO NOTHING;

INSERT INTO persona_versions (persona_id, version, status, definition, compiled, changes, note, published_at)
SELECT p.id, 1, 'published',
       $json${
  "schemaVersion": 1,
  "label": {
    "en": "Chat team"
  },
  "summary": {
    "en": "Conversations, channels and contacts. The sales side stays out of the way."
  },
  "icon": "message-circle",
  "teamSizes": [],
  "vocabulary": {
    "nouns": {},
    "phrases": {}
  },
  "modules": {
    "default": "show",
    "ids": {
      "nav:deals": "hide",
      "nav:companies": "hide",
      "nav:tasks": "hide",
      "nav:crm-dashboard": "hide",
      "nav:invoices": "hide",
      "nav:payments": "hide",
      "nav:sales-orders": "hide",
      "nav:credit-notes": "hide",
      "nav:recurring-invoices": "hide",
      "nav:proposals": "hide",
      "nav:estimates": "hide",
      "nav:appointments": "hide",
      "nav:forms": "hide",
      "nav:lead-scoring": "hide",
      "nav:growth": "hide",
      "tile:deal-pipelines": "hide",
      "tile:record-assignment": "hide",
      "tile:lead-sources": "hide",
      "tile:lead-scoring": "hide",
      "tile:sales-activities": "hide",
      "tile:tax-rates": "hide",
      "tile:uncontacted-leads": "hide",
      "tile:follow-ups": "hide",
      "tile:duplicate-leads": "hide",
      "tile:company-properties": "hide",
      "tile:booking-types": "hide",
      "tile:appointment-settings": "hide",
      "tile:booking-page-appearance": "hide",
      "section:contact.tasks": "hide",
      "section:contact.deals": "hide",
      "section:contact.appointments": "hide",
      "section:contact.sales": "hide",
      "section:contact.lead-source": "hide",
      "section:contact.company": "hide",
      "section:contact.meetings": "hide",
      "action:contact.task": "hide",
      "action:contact.meeting": "hide",
      "action:contact.company": "hide",
      "action:contact.score": "hide",
      "card:dashboard.pipeline": "hide",
      "card:dashboard.funnel": "hide"
    }
  },
  "presets": {
    "addons": [],
    "bookingTypes": [],
    "lifecycleStages": [],
    "pipelines": [],
    "templates": [],
    "settings": {}
  },
  "checklist": []
}$json$::jsonb,
       '{}'::jsonb, '[]'::jsonb,
       'Initial version: edition preset.', now()
FROM personas p
WHERE p.key = 'chat_team'
ON CONFLICT (persona_id, version) DO NOTHING;

INSERT INTO personas (key, status, is_system, sort_order, current_version)
VALUES ('sales_team', 'active', false, 2, 1)
ON CONFLICT (key) DO NOTHING;

INSERT INTO persona_versions (persona_id, version, status, definition, compiled, changes, note, published_at)
SELECT p.id, 1, 'published',
       $json${
  "schemaVersion": 1,
  "label": {
    "en": "Sales team"
  },
  "summary": {
    "en": "Contacts, companies, deals and tasks. The inbox and chat channels stay out of the way."
  },
  "icon": "briefcase",
  "teamSizes": [],
  "vocabulary": {
    "nouns": {},
    "phrases": {}
  },
  "modules": {
    "default": "show",
    "ids": {
      "nav:inbox": "hide",
      "nav:inbox-message-logs": "hide",
      "nav:inbox-saved-replies": "hide",
      "nav:quick-chat": "hide",
      "nav:team-chat": "hide",
      "nav:call-logs": "hide",
      "nav:campaigns": "hide",
      "nav:scheduled": "hide",
      "nav:warmer": "hide",
      "nav:history": "hide",
      "nav:templates": "hide",
      "nav:wa-forms": "hide",
      "nav:wa-links": "hide",
      "nav:waba-groups": "hide",
      "nav:devices": "hide",
      "nav:devices-groups": "hide",
      "nav:facebook": "hide",
      "nav:facebook-posts": "hide",
      "nav:facebook-broadcasts": "hide",
      "nav:facebook-setup": "hide",
      "nav:instagram": "hide",
      "nav:instagram-broadcast": "hide",
      "nav:line": "hide",
      "nav:telegram": "hide",
      "nav:viber": "hide",
      "nav:wechat": "hide",
      "tile:saved-replies": "hide",
      "tile:inbox-tags": "hide",
      "tile:message-logs": "hide",
      "tile:auto-assignment": "hide",
      "tile:assignment-settings": "hide",
      "tile:sla-policies": "hide",
      "tile:team-performance": "hide",
      "tile:auto-reply": "hide",
      "tile:chat-widget": "hide",
      "tile:calling": "hide",
      "tile:facebook": "hide",
      "tile:instagram": "hide",
      "tile:line": "hide",
      "tile:telegram": "hide",
      "tile:viber": "hide",
      "tile:wechat": "hide",
      "tile:tiktok": "hide",
      "tile:unofficial-whatsapp": "hide",
      "section:contact.conversations": "hide",
      "action:contact.call": "hide",
      "card:dashboard.inbox": "hide",
      "card:dashboard.sent": "hide",
      "card:dashboard.read": "hide",
      "card:dashboard.instagram": "hide",
      "card:dashboard.devices": "hide",
      "card:dashboard.templates": "hide",
      "card:dashboard.campaigns": "hide"
    }
  },
  "presets": {
    "addons": [],
    "bookingTypes": [],
    "lifecycleStages": [],
    "pipelines": [],
    "templates": [],
    "settings": {}
  },
  "checklist": []
}$json$::jsonb,
       '{}'::jsonb, '[]'::jsonb,
       'Initial version: edition preset.', now()
FROM personas p
WHERE p.key = 'sales_team'
ON CONFLICT (persona_id, version) DO NOTHING;

INSERT INTO personas (key, status, is_system, sort_order, current_version)
VALUES ('both', 'active', false, 3, 1)
ON CONFLICT (key) DO NOTHING;

INSERT INTO persona_versions (persona_id, version, status, definition, compiled, changes, note, published_at)
SELECT p.id, 1, 'published',
       $json${
  "schemaVersion": 1,
  "label": {
    "en": "Chat and sales"
  },
  "summary": {
    "en": "The whole product: conversations and the sales CRM together."
  },
  "icon": "layers",
  "teamSizes": [],
  "vocabulary": {
    "nouns": {},
    "phrases": {}
  },
  "modules": {
    "default": "show",
    "ids": {}
  },
  "presets": {
    "addons": [],
    "bookingTypes": [],
    "lifecycleStages": [],
    "pipelines": [],
    "templates": [],
    "settings": {}
  },
  "checklist": []
}$json$::jsonb,
       '{}'::jsonb, '[]'::jsonb,
       'Initial version: edition preset.', now()
FROM personas p
WHERE p.key = 'both'
ON CONFLICT (persona_id, version) DO NOTHING;

