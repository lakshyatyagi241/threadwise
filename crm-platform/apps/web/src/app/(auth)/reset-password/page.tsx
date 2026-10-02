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
  guestPanel,
  loadPasswordPolicy,
  loadRegistrationConfig,
} from '@/features/auth-registration-security/guest/server';

export const generateMetadata = () => guestMetadata('reset');

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Reset password (TW-AUTH-014): opened from the emailed link `?org=&token=`. An email-link landing page, so a
 * signed-in visitor is not redirected away. Fixed split design with a panel of its own, whatever design the
 * administrator picked for the sign-in pages, as in Reference.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const org = cleanSlug(firstParam(sp.org));
  const token = firstParam(sp.token).trim();
  const [config, policy] = await Promise.all([loadRegistrationConfig(), loadPasswordPolicy()]);
  const usable = Boolean(org) && token.length >= 16 && token.length <= 128;
  return (
    <GuestFrame
      page="forgot"
      config={config}
      fixedPanel={await guestPanel('reset')}
      header={await guestHeader('reset')}
    >
      {usable ? (
        <ResetForm org={org} token={token} passwordPolicy={policy} />
      ) : (
        <InvalidResetLink org={org} />
      )}
    </GuestFrame>
  );
}
