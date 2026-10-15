-- contacts: a bump of `last_activity_at` alone is bookkeeping, not an edit.
--
-- Why: `last_activity_at` now moves on every customer message and every staff reply (the chat module stamps it), not only on a note,
-- a meeting or a file. touch_row() would turn each of those into a new row_version, so a person with the contact open in the inbox
-- side panel or the edit form would get a 409 on their next save while the customer is simply typing. The same bump from a note has
-- always done that; chat makes it constant.
--
-- touch_row() for contacts, except that an UPDATE which changes nothing but `last_activity_at` keeps `updated_at` and `row_version`
-- (the pattern of lead_sources_touch). The jsonb comparison only runs when `last_activity_at` actually moved, so an ordinary edit
-- pays nothing extra.

CREATE OR REPLACE FUNCTION contacts_touch() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.last_activity_at IS DISTINCT FROM OLD.last_activity_at
     AND (to_jsonb(NEW) - ARRAY['last_activity_at', 'updated_at', 'row_version'])
       = (to_jsonb(OLD) - ARRAY['last_activity_at', 'updated_at', 'row_version']) THEN
    NEW.updated_at := OLD.updated_at;
    NEW.row_version := OLD.row_version;
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END $$;

DROP TRIGGER trg_contacts_touch ON contacts;
CREATE TRIGGER trg_contacts_touch BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_touch();
