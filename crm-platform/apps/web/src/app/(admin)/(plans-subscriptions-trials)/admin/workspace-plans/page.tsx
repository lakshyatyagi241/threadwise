import { redirect } from 'next/navigation';
import { hubRedirectPath } from '@/features/workspaces-hub/lib/redirect';

/** The separate workspace list moved into the Workspaces page (temporary redirect; the detail pages keep their addresses). */
export default async function MovedToWorkspaces({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(hubRedirectPath(await searchParams));
}
