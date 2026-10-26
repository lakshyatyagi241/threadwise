import { redirect } from 'next/navigation';

/** The handoff and owner settings now sit under Advanced on the Auto-assignment page; the old address keeps working. */
export default function AssignmentSettingsPage() {
  redirect('/auto-assignment');
}
