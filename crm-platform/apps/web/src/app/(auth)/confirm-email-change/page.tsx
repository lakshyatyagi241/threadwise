import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import { LinkLanding } from '@/features/auth-registration-security/guest/link-landing';
import {
  cleanSlug,
  firstParam,
  guestHeader,
  guestMetadata,
  guestPanel,
  loadRegistrationConfig,
} from '@/features/auth-registration-security/guest/server';

export const generateMetadata = () => guestMetadata('confirmEmailChange');

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Landing page of the "confirm your new email" link `?org=&token=`. Works while signed in too. */
export default async function ConfirmEmailChangePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const org = cleanSlug(firstParam(sp.org));
  const token = firstParam(sp.token).trim();
  const config = await loadRegistrationConfig();
  const usable = Boolean(org) && token.length >= 16 && token.length <= 128;
  return (
    <GuestFrame
      page="forgot"
      config={config}
      fixedPanel={await guestPanel('confirmEmailChange')}
      header={await guestHeader('confirmEmailChange')}
    >
      <LinkLanding kind="confirmEmailChange" org={org} token={token} usable={usable} />
    </GuestFrame>
  );
}
