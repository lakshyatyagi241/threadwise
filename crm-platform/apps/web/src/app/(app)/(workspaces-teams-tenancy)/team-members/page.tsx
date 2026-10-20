import { redirect } from 'next/navigation';

/**
 * `/team-members` was the second Team members screen (TW-WSP-015..019). Teams v2 folded it into Settings > Team members
 * (`/settings/team`), which now has the Teams and Manager columns, the team filter, the deactivate hand-over and a "More" menu with
 * every account action this page had (details, leave and reassign, resend invite, reset password, remove). The link of the
 * "went on leave" notice (`?member=<id>&reassign=1`) and any other query are passed on, so it opens that person's leave dialog.
 */
export default async function TeamMembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, v);
    }
  }
  const query = params.toString();
  redirect(query ? `/settings/team?${query}` : '/settings/team');
}
