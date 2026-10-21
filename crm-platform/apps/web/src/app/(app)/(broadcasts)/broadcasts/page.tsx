import { redirect } from 'next/navigation';

/** Broadcasts are campaigns now: the old list address leads to Campaigns. Old broadcast rows open from their own page (`/campaigns/earlier/:id`). */
export default function BroadcastsPage() {
  redirect('/campaigns');
}
