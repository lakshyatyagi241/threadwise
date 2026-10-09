import { redirect } from 'next/navigation';

/** Creating a broadcast is Campaigns, Create: the number picked there decides the flow. */
export default function NewBroadcastPage() {
  redirect('/campaigns/create');
}
