import { redirect } from 'next/navigation';

/** Old links pointed here (TW-AIADM-007); the page lives at /admin/api-keys. */
export default function LegacyAiKeysRedirect() {
  redirect('/admin/api-keys');
}
