import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import { LinkLanding } from '@/features/auth-registration-security/guest/link-landing';
import {
  cleanSlug,
  firstParam,
  guestHeader,
  guestMetadata,
  loadRegistrationConfig,
} from '@/features/auth-registration-security/guest/server';

export const generateMetadata = () => guestMetadata('verifyEmail');

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Landing page of the emailed verification link `?org=&token=` (WD-AUTH-015). Posts the token once; it never
 * signs anyone in. Works while signed in too.
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const org = cleanSlug(firstParam(sp.org));
  const token = firstParam(sp.token).trim();
  const config = await loadRegistrationConfig();
  const usable = Boolean(org) && token.length >= 16 && token.length <= 128;
  return (
    <GuestFrame page="forgot" variant={3} config={config} header={await guestHeader('verifyEmail')}>
      <LinkLanding kind="verifyEmail" org={org} token={token} usable={usable} />
    </GuestFrame>
  );
}
