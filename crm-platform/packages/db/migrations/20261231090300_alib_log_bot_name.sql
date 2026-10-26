-- The bot (flow) an API run came from, by name. The run log is a stream with no foreign keys, so a bot that is later deleted leaves only
-- its id: this keeps the name the bot had at the time of the run. While the bot exists its CURRENT name is shown (a rename shows at once);
-- the stored name is only for a bot that has been deleted since.
ALTER TABLE api_library_logs ADD COLUMN IF NOT EXISTS flow_name text;
