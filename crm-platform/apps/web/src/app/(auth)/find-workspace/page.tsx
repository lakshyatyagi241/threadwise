import { FindWorkspaceForm } from '@/features/auth-registration-security/guest/find-workspace-form';
import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import {
  guestHeader,
  guestMetadata,
  loadRegistrationConfig,
  redirectIfSignedIn,
} from '@/features/auth-registration-security/guest/server';

export const generateMetadata = () => guestMetadata('findWorkspace');

/** "Find my workspace": the email-only entry that mails the workspace addresses of a verified account. */
export default async function FindWorkspacePage() {
  await redirectIfSignedIn();
  const config = await loadRegistrationConfig();
  return (
    <GuestFrame page="login" config={config} header={await guestHeader('findWorkspace')}>
      <FindWorkspaceForm config={config} />
    </GuestFrame>
  );
}
