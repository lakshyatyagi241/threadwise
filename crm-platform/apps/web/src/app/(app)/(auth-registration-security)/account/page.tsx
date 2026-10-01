import { redirect } from 'next/navigation';

/** `/account` is the hub's front door; the profile pane is the first one. */
export default function AccountIndex() {
  redirect('/account/profile');
}
