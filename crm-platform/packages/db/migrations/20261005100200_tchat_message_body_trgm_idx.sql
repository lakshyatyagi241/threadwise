-- @no-transaction
-- tchat: trigram index for searching a channel's messages (WD-TCHAT-020).
-- Why this migration exists: WaDesk stored the body encrypted, so its LIKE search matched nothing. The body is plain text here
-- (the one deliberate deviation, see port-map) and the search is ILIKE '%word%', which a btree cannot serve. CONCURRENTLY, so
-- this file runs outside a transaction and holds exactly one statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_team_chat_messages_body_trgm
  ON team_chat_messages USING gin (body gin_trgm_ops);
