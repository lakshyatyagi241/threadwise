import { redirect } from 'next/navigation';

/** Reference's address for sign-up; referral links and old bookmarks keep working. */
export default async function RegisterRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, v);
    }
  }
  const qs = query.toString();
  redirect(qs ? `/signup?${qs}` : '/signup');
}
