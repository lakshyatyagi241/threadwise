-- 2029_api_keys_explicit_scopes
-- Why this migration exists (not what it does — the SQL says that):
--
-- A bearer key with no scopes was full access (TW-API-008): it reached every scope, including any added later. Key creation now requires
-- at least one scope, so only keys created before this migration can have none. Those keys keep exactly the access they have today,
-- written out as the explicit list of every scope that exists at this migration, so nothing stops working. The list is fixed here on
-- purpose: a scope added later is not granted to these keys. Signed partner keys share the table and are not changed.
--
-- api_keys has FORCE ROW LEVEL SECURITY and the migration runner sets no tenant context, so without app.privileged the UPDATE matches no
-- row. The setting is transaction-local. A second run matches no rows, because no bearer key is left with an empty list.

SELECT set_config('app.privileged', 'on', true);

UPDATE api_keys
   SET scopes = ARRAY[
  'account:read', 'account:write', 'contacts:read', 'contacts:write',
  'contact-groups:read', 'contact-groups:write', 'deals:read', 'deals:write',
  'companies:read', 'companies:write', 'flows:read', 'flows:write',
  'templates:read', 'templates:write', 'auto-replies:read', 'auto-replies:write',
  'broadcasts:read', 'broadcasts:write', 'campaigns:read', 'campaigns:write',
  'scheduled:read', 'scheduled:write', 'messages:read', 'messages:write',
  'media:read', 'media:write', 'conversations:read', 'conversations:write',
  'devices:read', 'devices:write', 'webhooks:read', 'webhooks:write'
   ]::text[]
 WHERE kind = 'bearer'
   AND cardinality(scopes) = 0;
