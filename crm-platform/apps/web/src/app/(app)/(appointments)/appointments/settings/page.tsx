import { Suspense } from 'react';
import { SettingsScreen } from '@/features/appointments/components/settings-screen';

export default function AppointmentsSettingsPage() {
  // The Google Calendar card reads the address (`useSearchParams`) for the outcome Google's callback leaves, which needs a Suspense boundary.
  return (
    <Suspense>
      <SettingsScreen />
    </Suspense>
  );
}
