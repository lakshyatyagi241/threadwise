-- contacts: capability key gating full (unmasked) customer phone numbers in the Contacts API.
-- Why this migration exists: TW-AUTH-042 (Reference's phone-masking toggle) is inventoried as dead code — the display
-- helper's masking branch is unreachable (early-returns the number unchanged) and the admin on/off toggle was removed
-- from the Security Center. The inventory's own port note says do NOT resurrect it as a global toggle; instead, if
-- masking is wanted, gate it as an RBAC field-level permission (agents see masked, admins/owners see full). The
-- product owner signed off on exactly that redesign. This is a new capability, not a Reference feature with a 1:1
-- route or screen, so it carries no TW-* id.
--
-- Scope for this pass is Contacts only (list + detail). Team Inbox, Calling, Forms and any other surface that shows a
-- phone number are explicitly out of scope and still show the raw stored number until each is visited separately.
--
--   contacts.phone.reveal   see a contact's phone number unmasked in the Contacts API; without it, the API itself
--                            returns the masked string (not a client-side hide) for list and detail responses.
--
-- Owner and Admin presets get this automatically: 20261013100000's `trg_permission_defs_grant_presets` trigger grants
-- every newly inserted permission_defs key to the roles with system_key 'admin' (Owner) and 'workspace_admin' (Admin)
-- for every existing organization, bypassing the locked-role trigger via `app.rbac_preset_sync` — the same insert
-- below that registers the key is what fires it, no separate role_grants statement needed here. Manager, Agent and
-- Viewer deliberately get nothing: they are the actors this permission exists to mask from by default. A workspace
-- can still widen that later through its own role editor.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('contacts.phone.reveal', 'View customer phone numbers unmasked', 'contacts', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;
