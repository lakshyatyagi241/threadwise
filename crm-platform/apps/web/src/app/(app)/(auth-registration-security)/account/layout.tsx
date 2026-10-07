import type { ReactNode } from 'react';
import { AccountShell } from '@/features/auth-registration-security/account/hub/account-shell';

/** The account hub frame shared by /account/profile, /plans, /security and /delete (WD-AUTH-024). */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
