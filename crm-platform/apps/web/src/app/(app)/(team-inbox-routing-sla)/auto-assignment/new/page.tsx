import { RuleFormScreen } from '@/features/team-inbox-routing-sla/components/rule-form-screen';

export default async function NewRoutingRulePage({
  searchParams,
}: {
  searchParams: Promise<{ everyoneElse?: string }>;
}) {
  const { everyoneElse } = await searchParams;
  return <RuleFormScreen everyoneElse={everyoneElse === '1'} />;
}
