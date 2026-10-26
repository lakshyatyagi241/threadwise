/**
 * The browser tab title has two writers: the shell names the page (`<Page> | <Workspace>`, components/shell/page-title) and the live
 * notifications put an unread badge in front of it (`(3) `, features/notifications-activity-audit/live). Each watches `<head>` and
 * repairs the title when someone else changes it, so each has to leave the other's part alone, or the two rewrite each other
 * without end (tens of thousands of title writes a second, a frozen tab). The badge syntax lives here, in one place both can import.
 */

const BADGE_PREFIX = /^\(\d+\+?\)\s+/;

export interface SplitTitle {
  /** `(3) ` including the trailing space, or '' when the title carries no badge. */
  badge: string;
  /** The title without the badge. */
  base: string;
}

/** Separates an unread badge from the page title. A parenthesised word such as `(beta) Inbox` is part of the title, not a badge. */
export function splitTitleBadge(title: string): SplitTitle {
  const badge = BADGE_PREFIX.exec(title)?.[0] ?? '';
  return { badge, base: title.slice(badge.length) };
}
