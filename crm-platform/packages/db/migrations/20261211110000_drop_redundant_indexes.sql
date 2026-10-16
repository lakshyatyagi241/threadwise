-- Drop seven indexes that a wider index already serves (QA 40, "no redundant indexes").
--
-- Each dropped index is a leading prefix of a kept index on the same table, so every lookup it served is still served by the kept one:
-- an equality or range on the shared leading columns uses the wider index, and a btree can be scanned backward, so an ascending
-- (org_id, x) order is also served by (org_id, x DESC, id DESC). None is partial, unique or a constraint, and no code names them.
-- The cost of keeping them was a write on every insert and update, plus the storage.
--
--   dropped                                   kept
--   idx_chatbot_widget_visitors_widget_id     idx_chatbot_widget_visitors_uuid_widget (org_id, widget_id, visitor_uuid)
--   idx_conversation_events_conversation_id   idx_conversation_events_timeline        (org_id, conversation_id, created_at DESC, id DESC)
--   idx_deal_activities_deal_id_created_at    idx_deal_activities_timeline            (org_id, deal_id, created_at DESC, id DESC)
--   idx_payments_paid_at                      idx_payments_list                       (org_id, paid_at DESC, id DESC)
--   idx_appointments_starts_at                idx_appointments_starts_id              (org_id, starts_at, id)
--   idx_appointments_status                   idx_appointments_status_starts          (org_id, status, starts_at, id)
--   idx_faq_variations_faq                    uq_faq_variations_text                  (org_id, faq_id, lower(btrim(text)))
--
-- DROP INDEX takes a short exclusive lock on the table. It is quick, but run it outside a busy hour on a large database.

DROP INDEX IF EXISTS idx_chatbot_widget_visitors_widget_id;
DROP INDEX IF EXISTS idx_conversation_events_conversation_id;
DROP INDEX IF EXISTS idx_deal_activities_deal_id_created_at;
DROP INDEX IF EXISTS idx_payments_paid_at;
DROP INDEX IF EXISTS idx_appointments_starts_at;
DROP INDEX IF EXISTS idx_appointments_status;
DROP INDEX IF EXISTS idx_faq_variations_faq;
