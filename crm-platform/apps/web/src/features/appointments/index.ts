/** Public surface of the appointments domain. Other domains import from here, never from the folders below. */
export { LinkedAppointments, type LinkedAppointmentsProps } from './components/linked-appointments';
/** The contact's Meetings list tags a booked meeting with its appointment's status and links to the booking. */
export { StatusChip as AppointmentStatusChip } from './components/parts';
