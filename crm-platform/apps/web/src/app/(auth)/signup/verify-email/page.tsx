import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import { SignupVerifyEmailForm } from '@/features/auth-registration-security/guest/signup-verify-email-form';
import {
  guestMetadata,
  loadRegistrationConfig,
  redirectIfSignedIn,
} from '@/features/auth-registration-security/guest/server';

export const generateMetadata = () => guestMetadata('signup');

/** Sign-up step 2 of 3: check the code sent to the visitor's email (TW-AUTH-006 email-verification redesign). */
export default async function SignupVerifyEmailPage() {
  await redirectIfSignedIn();
  const config = await loadRegistrationConfig();
  return (
    <GuestFrame page="register" config={config}>
      <SignupVerifyEmailForm />
    </GuestFrame>
  );
}
