import { redirect } from 'next/navigation';

/** Broadcasts are campaigns now: the old list address leads to Campaigns. Old rows stay under Campaign history, Legacy broadcasts. */
export default function BroadcastsPage() {
  redirect('/campaigns');
}
