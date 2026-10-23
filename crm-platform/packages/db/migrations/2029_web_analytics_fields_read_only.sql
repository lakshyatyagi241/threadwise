-- 2029_web_analytics_fields_read_only
-- Why this migration exists (not what it does — the SQL says that):
--
-- The contact properties of the "Web Analytics Information" section (referrer, UTM, device, browser, IP place, channel, bot, module and
-- platform facts) record how a contact arrived. They came in from the old system as ordinary editable fields, so anyone who could edit a
-- contact could rewrite them, and a bulk update, an import or a flow step could too. Nobody is meant to edit them by hand.
--
-- The platform already refuses writes to a read-only property everywhere a person or an automation edits a contact (contact form, bulk
-- update, import, flow steps), so the whole fix is the flag. It is set only on fields that sit in a section of that name, so a workspace
-- that has its own property called `channel` or `platform` somewhere else keeps it editable. A workspace that deliberately turns the flag
-- off again afterwards is not touched again: this runs once.

-- one pass over every workspace
SELECT set_config('app.privileged', 'on', true);

UPDATE fields f
   SET is_read_only = true,
       updated_at = now(),
       row_version = f.row_version + 1
  FROM field_sections s
 WHERE s.org_id = f.org_id
   AND s.id = f.section_id
   AND s.module_key = 'contacts'
   AND lower(btrim(s.name)) = 'web analytics information'
   AND f.module_key = 'contacts'
   AND f.is_read_only = false
   AND f.key IN (
     'referrer', 'referrer_name', 'referrer_keyword', 'referrer_url',
     'utm_medium', 'utm_campaign', 'utm_source',
     'device_type', 'device_model', 'operating_system', 'operating_system_name', 'browser_version', 'browser_name',
     'ip_continent', 'ip_country_region', 'ip_state_region', 'ip_city',
     'channel', 'bot_name', 'module_type', 'module_name', 'platform'
   );
