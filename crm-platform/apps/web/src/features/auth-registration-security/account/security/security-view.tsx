'use client';

import { useSession } from '../../shared/session-context';
import { ChangePasswordForm } from './change-password-form';
import { MfaPanel } from './mfa-panel';
import { SessionsPanel } from './sessions-panel';

/**
 * "Change password & security" (TW-AUTH-024/027/030/031): the password form,
 * two-factor and the device list on one page. `?required=password|mfa` is the
 * forced mode the account gate redirects to (TW-AUTH-032, TW-AUTH-035).
 */
export function SecurityView({ required }: { required?: 'password' | 'mfa' }) {
  const { flags } = useSession();
  return (
    <div className="space-y-5">
      <ChangePasswordForm forced={flags.passwordChangeRequired || required === 'password'} />
      <MfaPanel forcedByUrl={required === 'mfa'} />
      <SessionsPanel />
    </div>
  );
}
