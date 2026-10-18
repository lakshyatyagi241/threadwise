import { redirect } from 'next/navigation';

/** The screen used to live here as "Contact assignment"; it now covers contacts, companies and deals at `/record-assignment`. */
export default function ContactAssignmentPage(): never {
  redirect('/record-assignment');
}
