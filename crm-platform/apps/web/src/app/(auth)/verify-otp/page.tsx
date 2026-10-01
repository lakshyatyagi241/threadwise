import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import { OtpForm } from '@/features/auth-registration-security/guest/otp-form';
import {
  guestHeader,
  guestMetadata,
  loadRegistrationConfig,
  redirectIfSignedIn,
} from '@/features/auth-registration-security/guest/server';

export const generateMetadata = () => guestMetadata('verifyOtp');

/** WhatsApp code check of a pending sign-up (TW-AUTH-006). Follows the admin's design, like sign-up. */
export default async function VerifyOtpPage() {
  await redirectIfSignedIn();
  const config = await loadRegistrationConfig();
  return (
    <GuestFrame page="register" config={config} header={await guestHeader('verifyOtp')}>
      <OtpForm />
    </GuestFrame>
  );
}
