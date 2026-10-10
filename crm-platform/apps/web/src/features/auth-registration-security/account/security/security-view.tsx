'use client';

import { useSession } from '../../shared/session-context';
import { ChangePasswordForm } from './change-password-form';
import { MfaPanel } from './mfa-panel';
import { AccountPasskeys } from './passkeys-card';
import { SessionsPanel } from './sessions-panel';

/**
 * "Change password & security" (WD-AUTH-024/027/030/031): the password form,
 * two-factor, passkeys and the device list on one page. `?required=password|mfa` is the
 * forced mode the account gate redirects to (WD-AUTH-032, WD-AUTH-035); the card
 * the person has to finish comes first.
 */
export function SecurityView({ required }: { required?: 'password' | 'mfa' }) {
  const { flags } = useSession();
  const passwordForced = flags.passwordChangeRequired || required === 'password';
  const mfaForced = flags.mfaEnrolmentRequired || required === 'mfa';
  const mfaFirst = mfaForced && !passwordForced;
  const password = <ChangePasswordForm key="password" forced={passwordForced} />;
  const mfa = <MfaPanel key="mfa" forcedByUrl={required === 'mfa'} />;
  return (
    <div className="space-y-5">
      {mfaFirst ? [mfa, password] : [password, mfa]}
      <AccountPasskeys />
      <SessionsPanel />
    </div>
  );
}
