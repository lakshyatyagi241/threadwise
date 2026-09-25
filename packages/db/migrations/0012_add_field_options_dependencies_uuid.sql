-- 0012_add_field_options_dependencies_uuid
-- 0010 gave field_sections/fields/status_options a `uuid` column but missed
-- it on field_options, field_dependencies and field_option_dependencies —
-- every one of those ids appears on the wire too (ADR-0016: internal bigint
-- ids never leave the system), so all three need the same treatment.

ALTER TABLE field_options ADD COLUMN uuid uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE field_options ADD CONSTRAINT field_options_org_id_uuid_key UNIQUE (org_id, uuid);

ALTER TABLE field_dependencies ADD COLUMN uuid uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE field_dependencies ADD CONSTRAINT field_dependencies_org_id_uuid_key UNIQUE (org_id, uuid);

ALTER TABLE field_option_dependencies ADD COLUMN uuid uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE field_option_dependencies ADD CONSTRAINT field_option_dependencies_org_id_uuid_key UNIQUE (org_id, uuid);
