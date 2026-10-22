-- 20270327090100_repair_migrated_view_share_mode
-- Why this migration exists (not what it does — the SQL says that):
--
-- The Waboo migration tool wrote shared saved views with is_shared = true but never wrote share_mode, so the column default 'me'
-- applied. A 'me' view is visible only to its creator, so views such as ISKM-RY26 and WLF were missing for everyone else. The service
-- keeps is_shared = (share_mode <> 'me') (see 20261118090000_contact_view_sharing.sql), so is_shared = true with share_mode = 'me' can
-- only come from that loader. Those views were shared with everyone in Waboo, so they become 'everyone'. access_type is left alone:
-- the loader does not carry edit rights, so they stay can_view. A second run matches no rows.
--
-- contact_views has FORCE ROW LEVEL SECURITY and the migration runner sets no tenant context, so without app.privileged the policy
-- hides every row from the migration role and this UPDATE changes nothing. The setting is transaction-local.

SELECT set_config('app.privileged', 'on', true);

UPDATE contact_views
   SET share_mode = 'everyone'
 WHERE is_shared
   AND share_mode = 'me';
