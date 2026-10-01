import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { OperatorShell } from '@/features/auth-registration-security/platform/operator-shell';
import { getOperatorSession } from '@/lib/auth/server';

/** Platform-operator console: a separate identity pool from workspace staff. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { session, expired } = await getOperatorSession();
  if (!session) redirect(expired ? '/api/platform-auth/refresh?next=/admin' : '/admin/login');
  return <OperatorShell operator={session}>{children}</OperatorShell>;
}
