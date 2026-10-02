import type { ReactNode } from 'react';
import { AppointmentsProviders } from '@/features/appointments/components/providers';

/** Shared frame of the Appointments screens: the toast region. */
export default function AppointmentsDomainLayout({ children }: { children: ReactNode }) {
  return <AppointmentsProviders>{children}</AppointmentsProviders>;
}
