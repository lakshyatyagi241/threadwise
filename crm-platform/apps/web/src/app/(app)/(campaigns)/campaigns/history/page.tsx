import { redirect } from 'next/navigation';

/** The separate history page is gone from the menu: the Campaigns list shows every campaign and its state. */
export default function Page(): never {
  redirect('/campaigns');
}
