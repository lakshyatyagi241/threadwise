import { redirect } from 'next/navigation';

/** Old broadcast detail address: the same broadcast opens under Campaigns. */
export default async function OldBroadcastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/campaigns/earlier/${encodeURIComponent(id)}`);
}
