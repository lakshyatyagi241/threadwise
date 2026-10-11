-- bcast: broadcasts.device_id followed no foreign key, so a broadcast could name another workspace's number (AZ-018).
-- The column is polymorphic: with provider 'baileys' it holds a devices.id, with any other provider (waba, ...) a
-- wa_provider_configs.id (see BroadcastsReadRepository.sender). One composite FK cannot express that, so the same rule the
-- (org_id, x_id) composite FKs give every other reference is enforced by a trigger: the row named must exist IN THE SAME
-- ORG, in the table the provider selects. Violations raise foreign_key_violation like a real FK would.
-- Rows that already break the rule are detached first (device_id NULL = the workspace default sender) so the migration
-- cannot fail on existing data; the trigger only fires on writes, so nothing needs validating afterwards.
SELECT set_config('app.privileged', 'on', true);

UPDATE broadcasts b
   SET device_id = NULL
 WHERE b.device_id IS NOT NULL
   AND NOT CASE
     WHEN b.provider = 'baileys'
       THEN EXISTS (SELECT 1 FROM devices d WHERE d.org_id = b.org_id AND d.id = b.device_id)
     ELSE EXISTS (SELECT 1 FROM wa_provider_configs c WHERE c.org_id = b.org_id AND c.id = b.device_id)
   END;

CREATE FUNCTION broadcasts_check_sender() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.device_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.provider = 'baileys' THEN
    IF NOT EXISTS (SELECT 1 FROM devices d WHERE d.org_id = NEW.org_id AND d.id = NEW.device_id) THEN
      RAISE EXCEPTION 'broadcasts.device_id % is not a device of organization %', NEW.device_id, NEW.org_id
        USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'fk_broadcasts_device_id';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM wa_provider_configs c WHERE c.org_id = NEW.org_id AND c.id = NEW.device_id) THEN
    RAISE EXCEPTION 'broadcasts.device_id % is not a number of organization %', NEW.device_id, NEW.org_id
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'fk_broadcasts_device_id';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_broadcasts_check_sender
  BEFORE INSERT OR UPDATE OF device_id, provider ON broadcasts
  FOR EACH ROW EXECUTE FUNCTION broadcasts_check_sender();
