import { Suspense } from 'react';
import { AppointmentsScreen } from '@/features/appointments/components/appointments-screen';

export default function AppointmentsPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <AppointmentsScreen />
    </Suspense>
  );
}
