import { redirect } from 'next/navigation';

/**
 * FAQs belong to a flow now, so there is no workspace FAQ screen. `/faq` and every old `/faq/...` link (a bookmark, a link in an
 * old email or note) land on the flows list, where each flow's FAQs are on its own tab.
 */
export default function FaqMovedPage() {
  redirect('/flows');
}
