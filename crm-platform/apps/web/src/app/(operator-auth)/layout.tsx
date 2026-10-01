import type { ReactNode } from 'react';
import { LoginChrome } from '@/features/auth-registration-security/platform/login/login-chrome';

/** Public operator pages (sign-in): outside the guarded console layout, with a bare frame of their own. */
export default function OperatorAuthLayout({ children }: { children: ReactNode }) {
  return <LoginChrome>{children}</LoginChrome>;
}
