import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/auth/server';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session.user) redirect(session.expired ? '/api/auth/refresh?next=/admin' : '/login');
  return <div className="min-h-screen p-6">{children}</div>;
}
