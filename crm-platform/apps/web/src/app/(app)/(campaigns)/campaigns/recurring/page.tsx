import { RecurringBroadcastsScreen } from '@/features/campaigns/history/components/recurring-screen';
import { highlightOf } from '@/features/campaigns/history/lib';

/** `?new=<id>` marks the broadcast the wizard just launched. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ new?: string | string[] }>;
}) {
  const { new: created } = await searchParams;
  return <RecurringBroadcastsScreen highlight={highlightOf(created)} />;
}
