import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AssignmentsPage } from '@/features/whatsapp-providers/components/assignments-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('whatsapp-providers.assignments');
  return { title: t('title') };
}

export default function OperatorWhatsappAssignmentsPage() {
  return <AssignmentsPage />;
}
