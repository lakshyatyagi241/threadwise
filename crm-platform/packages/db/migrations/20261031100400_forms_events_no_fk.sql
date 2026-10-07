-- forms: the events stream has no foreign key (schema-invariants: a partitioned stream carries none).
-- Why this migration exists: 20261031100000 gave web_form_events a cascading foreign key to web_forms, which the repository's own rule for
-- streams forbids (a foreign key on a partitioned stream taxes every insert, and a stream is read by time, not by form). Applied migrations are
-- immutable, so this fixes forward. The service deletes a form's events itself when it deletes the form, and the retention sweep removes any
-- that remain after 90 days.
ALTER TABLE web_form_events DROP CONSTRAINT fk_web_form_events_form;
