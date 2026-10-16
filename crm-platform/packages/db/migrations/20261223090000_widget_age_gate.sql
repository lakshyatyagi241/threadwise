-- website chat widget: an optional age question on the intake form (BL-212, spec docs/specs/privacy-and-data-governance.md section 11.10).
--
-- Why: a chat intake collects a name, an email and a phone number and no age, so a minor could never be detected from it. A workspace that
-- needs to know (its profile asks, or it serves minors) can now turn on ONE question: a box "I confirm I am at least N years old", an age
-- or a date of birth. Nothing asks by default.
--
--   chatbot_widgets.age_gate               the gate: {enabled, mode, minAge, whenUnder}, parsed and defaulted by the application like
--                                          `launcher`. `{}` = off, so every existing widget behaves exactly as before.
--   chatbot_widget_visitors.age_checked_at when this visitor's answer passed the gate (an adult, or a minor the widget accepted). A
--                                          visitor with a value is not asked again; one without it must answer on the first message.
--                                          Nothing is kept for a visitor who is refused: no row, no profile, no age.

ALTER TABLE chatbot_widgets
  ADD COLUMN age_gate jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT chk_chatbot_widgets_age_gate_object CHECK (jsonb_typeof(age_gate) = 'object' AND pg_column_size(age_gate) <= 512);

ALTER TABLE chatbot_widget_visitors ADD COLUMN age_checked_at timestamptz;
