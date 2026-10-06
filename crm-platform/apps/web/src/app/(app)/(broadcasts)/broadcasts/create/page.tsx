import { redirect } from 'next/navigation';

/**
 * The old single-page composer is gone: creating a broadcast is the four-step wizard. This path stays so a bookmark, a dashboard
 * shortcut or an old link still lands in the right place.
 */
export default function NewBroadcastPage() {
  redirect('/campaigns/wizard');
}
