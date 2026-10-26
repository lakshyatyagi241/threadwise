-- 2034_call_log_entry_details
-- Why this migration exists (not what it does — the SQL says that):
--
-- A call is logged after it ends from the mobile app's "Add call" page (and the web's Log a call form can use the same fields): besides how
-- it went (direction, outcome, length) the person gives it a subject ("Follow-up on the quote"), says what it was for (the call purpose) and
-- what came of it (the call result), and may write a longer description. The description is the existing `notes`; the other three were
-- being folded into `notes` as text, which cannot be searched, filtered, reported on or shown as its own column. They get columns of their own.
--
--   subject   the call's heading; also the title of the line the call writes on the contact's timeline when it is given.
--   purpose   what the call was for, one of a short fixed list (the same six the phone offers); null when not said.
--   result    a short free-text line: what came of the call.
--
-- All three are optional and null on every existing entry (an entry reported by a phone's call log or a telephony provider has none), so no
-- backfill. `subject` and `result` are written by a person, so they can name one: the erasure registry anonymises them like `notes`.
-- A column added with no default and no rewrite is a catalog-only change; the table's RLS policy and trigger cover the new columns as they do the rest.

ALTER TABLE call_log_entries
  ADD COLUMN subject text,
  ADD COLUMN purpose text,
  ADD COLUMN result  text;

ALTER TABLE call_log_entries
  ADD CONSTRAINT ck_call_log_entries_purpose
    CHECK (purpose IS NULL OR purpose IN ('prospecting', 'administrative', 'negotiation', 'demo', 'project', 'desk')),
  ADD CONSTRAINT ck_call_log_entries_subject_len CHECK (subject IS NULL OR char_length(subject) BETWEEN 1 AND 191),
  ADD CONSTRAINT ck_call_log_entries_result_len  CHECK (result  IS NULL OR char_length(result)  BETWEEN 1 AND 500);
