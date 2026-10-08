-- cms: retire the guidebook. The in-app help centre is /help (guides written in the repo, gated by plan and role); the
-- operator-edited Reference guidebook, its helpful/not-helpful votes and its 32 sample articles are gone with it (owner decision
-- 2026-10-06, docs/threadwise-port/parity/marketing-site-cms.md). Nothing else reads these tables.
--
-- The votes table goes first (it references the articles), then the two counter functions that only served the guidebook.

DROP FUNCTION IF EXISTS cms_guidebook_view(text);
DROP FUNCTION IF EXISTS cms_guidebook_vote(bigint, text, text);

DROP TABLE IF EXISTS guidebook_votes;
DROP TABLE IF EXISTS guidebook_articles;
