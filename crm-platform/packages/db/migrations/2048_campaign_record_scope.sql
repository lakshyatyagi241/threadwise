-- 2048_campaign_record_scope
-- Why: the roles editor offered no "Global records / Restricted access" choice for campaigns (BL-430). The campaign keys that act
-- on a record can now carry a record scope: `all` (Global: every campaign of the workspace) or `own` (Restricted: only the
-- campaigns the user created). Existing grants keep their stored scope, which is `all`, so nobody loses access on deploy.
UPDATE permission_defs
   SET supports_scope = true
 WHERE key IN ('camp.campaigns.read', 'camp.campaigns.update', 'camp.campaigns.delete',
               'camp.campaigns.control', 'camp.campaigns.export', 'camp.campaigns.test');

-- Cached grants must not outlive the change.
UPDATE organizations SET roles_version = roles_version + 1;
