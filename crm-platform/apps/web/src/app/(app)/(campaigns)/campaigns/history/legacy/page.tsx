import { redirect } from 'next/navigation';

/** The old broadcast list address: the earlier broadcasts are a view of the Campaigns page now. */
export default function LegacyBroadcastsPage(): never {
  redirect('/campaigns?source=earlier');
}
