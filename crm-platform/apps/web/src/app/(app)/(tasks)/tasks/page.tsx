import { Suspense } from 'react';
import { TasksScreen } from '@/features/tasks/components/tasks-screen';

export default function TasksPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <TasksScreen />
    </Suspense>
  );
}
