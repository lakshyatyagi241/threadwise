-- 2049_template_record_scope
-- Why: same as 2048 for the template library (BL-430). The template keys that act on one template can now carry a record scope:
-- `all` (Global: every template of the workspace) or `own` (Restricted: only templates the user created, wa_templates.user_id).
-- Existing grants keep their stored scope, which is `all`, so nobody loses access on deploy.
UPDATE permission_defs
   SET supports_scope = true
 WHERE key IN ('tpl.templates.read', 'tpl.templates.create', 'tpl.templates.delete', 'tpl.templates.sync');

-- Cached grants must not outlive the change.
UPDATE organizations SET roles_version = roles_version + 1;
