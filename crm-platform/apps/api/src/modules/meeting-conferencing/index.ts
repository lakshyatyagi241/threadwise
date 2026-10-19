/**
 * Public surface of the meeting-conferencing module (BL-360..BL-362). Other modules import from here, never from the files behind it.
 *
 *   MeetingConferencingModule        the HTTP side and the `MEETING_CONFERENCING` binding (global)
 *   MeetingConferencingWorkerModule  the outbox consumer that removes rooms and events (worker process only)
 */
export { MeetingConferencingModule } from './meeting-conferencing.module';
export { MeetingConferencingWorkerModule } from './meeting-conferencing-worker.module';
