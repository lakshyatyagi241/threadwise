-- The builder a migrated Waboo chatbot opens in, for clients loaded BEFORE bots were written as Simple.
--
-- Why: the loader wrote every migrated flow with builder = 'advanced', so a Waboo chatbot (a bot of the bot builder) opened in the
-- Advanced canvas. In Waboo a bot opens in its simple editor and an automation in the advanced one; the load now does the same
-- (chatbots 'simple', automations 'advanced'). This moves the chatbots loaded earlier, once. A bot the Simple builder cannot show says
-- so there and offers Open in Advanced, so nothing becomes unreachable.
--
-- Only rows this tool wrote (category 'Waboo chatbot') that still say 'advanced' and have not been edited since the load
-- (row_version = 1: the touch trigger bumps it on any edit, and the flow-state step also moves it, so an armed flow is skipped: run this
-- BEFORE flow-state, or pass the org and accept that an armed one stays as it is). Idempotent.
--
-- Run as the owner inside one transaction and look at the preview first:
--
--   BEGIN;
--   \i flow-builder-bots-simple.sql      -- prints the preview, then updates
--   -- check the row count, then COMMIT; (or ROLLBACK;)

\echo == preview: the migrated chatbots that will open in Simple
SELECT org_id, id, flow_name, builder, row_version, is_published
  FROM flows
 WHERE category = 'Waboo chatbot' AND builder = 'advanced' AND row_version = 1
 ORDER BY org_id, id;

\echo == updating
UPDATE flows
   SET builder = 'simple'
 WHERE category = 'Waboo chatbot' AND builder = 'advanced' AND row_version = 1;
