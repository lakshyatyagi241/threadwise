import { redirect } from 'next/navigation';
import { USAGE_PATH } from '@/features/plans-subscriptions-trials/lib/format';

/** "Plan and usage" now lives on the Plans pane; old links, bookmarks and help text land on its usage section. */
export default function UsagePage() {
  redirect(USAGE_PATH);
}
