import { redirect } from 'next/navigation';

/** The task outcomes list is edited in the Task drawer of Settings > Data > Sales Activities now; the old address lands there. */
export default function TaskOutcomesPage() {
  redirect('/sales-activities');
}
