-- cms: fix cms_guidebook_vote() for a first vote. With no previous vote p_old is NULL, `(p_old = 'helpful')::int` is NULL
-- and the whole sum became NULL, so the counter stayed at zero. Each comparison now counts as 0 when it is NULL.
CREATE OR REPLACE FUNCTION cms_guidebook_vote(p_article bigint, p_old text, p_new text) RETURNS void
  LANGUAGE sql
  SET app.privileged = 'on'
  SET search_path = public, pg_temp
AS $$
  UPDATE guidebook_articles
  SET helpful_count = greatest(0, helpful_count + coalesce((p_new = 'helpful')::int, 0) - coalesce((p_old = 'helpful')::int, 0)),
      not_helpful_count = greatest(0, not_helpful_count + coalesce((p_new = 'not_helpful')::int, 0) - coalesce((p_old = 'not_helpful')::int, 0))
  WHERE id = p_article AND is_published;
$$;
