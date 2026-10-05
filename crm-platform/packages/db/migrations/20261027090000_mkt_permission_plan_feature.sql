-- Add-on permissions: which plan feature a permission key belongs to.
-- Why this migration exists: a workspace that has not bought an add-on (for example Appointments) should not see that add-on's keys in the
-- Roles editor, and an admin who buys it should see them appear. `plan_feature` names the plan feature that unlocks the key
-- (null = a core key, always shown). Enforcement is unchanged: routes still check the key with @RequirePermission, and the module gate
-- still blocks the add-on's routes when the feature is off. This column only decides visibility in the editor.
--
-- The Admin preset already holds these keys (workspace_preset_baseline), so the default after buying is "Admin has it, nobody else does".
ALTER TABLE permission_defs ADD COLUMN IF NOT EXISTS plan_feature text;

UPDATE permission_defs
SET plan_feature = 'appointment_booking'
WHERE key LIKE 'record.appointments.%' OR key LIKE 'record.booking-types.%';
