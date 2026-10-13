import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuditLogScreen } from '@/features/notifications-activity-audit/audit/components/audit-log-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('audit-log');
  return { title: t('title') };
}

/** Settings, Audit log (Reference: Activity Log): who changed what in the workspace. */
export default function ActivityLogRoute() {
  return <AuditLogScreen />;
}
