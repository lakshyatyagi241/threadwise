import { redirect } from 'next/navigation';

/** The first build served the page here; the Updater now lives at Reference's address, so old links keep working. */
export default function SystemPage(): never {
  redirect('/admin/update');
}
