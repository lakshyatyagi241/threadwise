/**
 * The port between a contact's meeting and the code that makes its video link and calendar entry real (BL-361, BL-362). Declared here, in
 * the module that owns the meeting, and bound by the meeting-conferencing module (which depends on the appointments calendar, so the crm
 * module cannot depend on it). When nothing is bound the meeting is saved exactly as it always was.
 */
export const MEETING_CONFERENCING = Symbol('MEETING_CONFERENCING');

export interface MeetingConferencingPort {
  /**
   * Makes the room and the calendar event the meeting row asks for, or moves them with the meeting, and records the answer (the join address
   * on the meeting, the provider's ids, a problem code when it did not work). Called AFTER the meeting's own transaction, so a provider
   * that is slow or down never holds a database connection or loses the meeting. Never throws: a failure is recorded on the row.
   */
  provision(orgId: number, meetingId: number): Promise<void>;
}

/** The outbox event the delete (or a change that drops a room or event) leaves for the worker, with what to remove captured in the payload. */
export const CONFERENCING_RELEASE_EVENT = 'contact_meeting.conferencing_release';
