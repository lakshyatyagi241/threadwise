-- cms: two things the public marketing site needs that the ported schema did not give it.
--
-- 1. contact_messages.public_insert. The contact form is posted by an anonymous visitor, so no tenant and no operator
--    exists when the row is written. The table only allowed privileged writes, which would force the public handler
--    onto a privileged connection. An INSERT-only policy (the same idea as security_events.append_any) lets any
--    connection add a message and nothing else: reading, updating and deleting stay operator-only.
--
-- 2. cms_record_blog_view(). The view counter is bumped on every public read, by an anonymous request. The function
--    carries the privileged flag for its own body only (a function-level SET is undone when the function returns, so
--    the flag never leaks into the caller's transaction) and does exactly one thing: add 1 to a LIVE post's counter.
--    The touch trigger no longer fires when only `views` changed, so a page view does not move `updated_at` (the
--    sitemap's lastmod and the article's dateModified) or `row_version` (an editor saving the post would otherwise get
--    a spurious conflict). WaDesk's counter most likely did bump updated_at; this is a deliberate fix.

CREATE POLICY public_insert ON contact_messages FOR INSERT WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_blog_posts_touch ON blog_posts;
CREATE TRIGGER trg_blog_posts_touch BEFORE UPDATE ON blog_posts
  FOR EACH ROW WHEN (OLD.views IS NOT DISTINCT FROM NEW.views)
  EXECUTE FUNCTION touch_row();

CREATE OR REPLACE FUNCTION cms_record_blog_view(p_slug text) RETURNS void
  LANGUAGE sql
  SET app.privileged = 'on'
  SET search_path = public, pg_temp
AS $$
  UPDATE blog_posts SET views = views + 1
  WHERE slug = p_slug AND status = 'published' AND (published_at IS NULL OR published_at <= now());
$$;

REVOKE ALL ON FUNCTION cms_record_blog_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cms_record_blog_view(text) TO crm_app, crm_worker;
