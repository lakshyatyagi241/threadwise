import { ForgotForm } from '@/features/auth-registration-security/guest/forgot-form';
import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import {
  cleanSlug,
  firstParam,
  guestMetadata,
  lastWorkspaceSlug,
  loadRegistrationConfig,
  redirectIfSignedIn,
} from '@/features/auth-registration-security/guest/server';

export const generateMetadata = () => guestMetadata('forgot');

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Forgot password (TW-AUTH-013). */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  await redirectIfSignedIn();
  const config = await loadRegistrationConfig();
  const defaultOrg = cleanSlug(firstParam(sp.org)) || cleanSlug(await lastWorkspaceSlug());
  return (
    <GuestFrame page="forgot" config={config}>
      <ForgotForm config={config} defaultOrg={defaultOrg} />
    </GuestFrame>
  );
}
