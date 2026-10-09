import { CreateScreen } from '@/features/campaigns/components/create-screen';
import { draftParam, senderParam } from '@/features/campaigns/lib/create-flow';

/** The one create screen: the sender number picks the guided flow (verified Meta number) or the classic builder, in place. */
export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ sender?: string | string[]; draft?: string | string[] }>;
}) {
  const { sender, draft } = await searchParams;
  return <CreateScreen sender={senderParam(sender)} draft={draftParam(draft)} />;
}
