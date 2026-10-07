import { notFound } from 'next/navigation';
import { RuleFormScreen } from '@/features/team-inbox-routing-sla/components/rule-form-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditRoutingRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <RuleFormScreen id={id} />;
}
