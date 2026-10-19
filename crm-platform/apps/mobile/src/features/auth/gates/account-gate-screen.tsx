import type { SessionResponse } from '@crm/contracts';
import type { Gate } from '@/lib/session/account-gate';
import { MfaView } from './mfa-view';
import { PasswordView } from './password-view';
import { SuspendedView } from './suspended-view';
import { VerifyEmailView } from './verify-email-view';

/**
 * The signed-in app's lock screens: the one thing a gated account can do, in place of the app. Shown by the signed-in layout while
 * `useAccountGate` names a gate. Each view leaves by itself once the session says its gate is open.
 */
export function AccountGateScreen({ gate, session }: { gate: Gate; session: SessionResponse }) {
  switch (gate) {
    case 'suspended':
      return <SuspendedView session={session} />;
    case 'password':
      return <PasswordView />;
    case 'mfa':
      return <MfaView />;
    case 'email':
      return <VerifyEmailView session={session} />;
  }
}
