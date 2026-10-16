import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import { SignupPasswordForm } from '@/features/auth-registration-security/guest/signup-password-form';
import {
  guestMetadata,
  loadPasswordPolicy,
  loadRegistrationConfig,
  redirectIfSignedIn,
} from '@/features/auth-registration-security/guest/server';

export const generateMetadata = () => guestMetadata('signup');

/** Sign-up step 3 of 3: the account's password and terms (TW-AUTH-006 email-verification redesign). */
export default async function SignupPasswordPage() {
  await redirectIfSignedIn();
  const [config, passwordPolicy] = await Promise.all([
    loadRegistrationConfig(),
    loadPasswordPolicy(),
  ]);
  return (
    <GuestFrame page="register" config={config}>
      <SignupPasswordForm config={config} passwordPolicy={passwordPolicy} />
    </GuestFrame>
  );
}
