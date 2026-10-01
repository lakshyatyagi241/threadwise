import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import {
  InvalidResetLink,
  ResetForm,
} from '@/features/auth-registration-security/guest/reset-form';
import {
  cleanSlug,
  firstParam,
  guestHeader,
  guestMetadata,
  loadRegistrationConfig,
} from '@/features/auth-registration-security/guest/server';

export const generateMetadata = () => guestMetadata('reset');

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Reset password (TW-AUTH-014): opened from the emailed link `?org=&token=`. An email-link landing page, so a
 * signed-in visitor is not redirected away. Fixed design (not variant-aware), as in Reference.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const org = cleanSlug(firstParam(sp.org));
  const token = firstParam(sp.token).trim();
  const config = await loadRegistrationConfig();
  const usable = Boolean(org) && token.length >= 16 && token.length <= 128;
  return (
    <GuestFrame page="forgot" variant={3} config={config} header={await guestHeader('reset')}>
      {usable ? <ResetForm org={org} token={token} /> : <InvalidResetLink org={org} />}
    </GuestFrame>
  );
}
