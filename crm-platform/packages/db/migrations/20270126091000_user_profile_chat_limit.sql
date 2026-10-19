-- team-members: a per-agent cap on open chats (Waboo's "Concurrent Chat" on the Users list, default 4 in its Add User form).
-- Why this migration exists: Desk had nowhere to keep the number, so the migrated limits (WABO 3, Ashish 5) were lost and routing could
-- never skip an agent who is already full. NULL means no limit, which is what every existing member keeps. The value lives on the
-- member's profile row (user_profiles already has RLS forced, the touch trigger and the composite key); routing reads it in
-- RoutingRulesRepository.available(), the members API returns and edits it.
ALTER TABLE user_profiles
  ADD COLUMN chat_limit integer,
  ADD CONSTRAINT ck_user_profiles_chat_limit CHECK (chat_limit IS NULL OR chat_limit BETWEEN 1 AND 1000);
