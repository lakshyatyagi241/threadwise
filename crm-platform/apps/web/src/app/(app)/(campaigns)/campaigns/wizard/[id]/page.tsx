import { notFound } from 'next/navigation';
import { WizardScreen } from '@/features/campaigns/wizard/components/wizard-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ResumeBroadcastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <WizardScreen draftId={id} />;
}
