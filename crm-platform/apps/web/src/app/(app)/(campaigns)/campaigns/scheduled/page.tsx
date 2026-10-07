import { ScheduledBroadcastsScreen } from '@/features/campaigns/history/components/scheduled-screen';
import { highlightOf } from '@/features/campaigns/history/lib';

/** `?new=<id>` marks the broadcast the wizard just launched. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ new?: string | string[] }>;
}) {
  const { new: created } = await searchParams;
  return <ScheduledBroadcastsScreen highlight={highlightOf(created)} />;
}
