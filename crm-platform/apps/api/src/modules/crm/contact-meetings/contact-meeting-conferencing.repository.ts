import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  ConferencingProblem,
  MeetingCalendarProvider,
  VideoProvider,
  VideoVia,
} from '@crm/contracts';
import { schema, type Tx } from '@crm/db';

const { contactMeetingConferencing } = schema;

export interface MeetingConferencingRow {
  id: number;
  meetingId: number;
  hostUserId: number | null;
  videoProvider: VideoProvider | null;
  videoMeetingId: string | null;
  videoVia: VideoVia | null;
  videoStatus: 'pending' | 'ready' | 'failed' | null;
  videoError: ConferencingProblem | null;
  addToCalendar: boolean;
  sendInvitation: boolean;
  calendarProvider: MeetingCalendarProvider | null;
  calendarId: string | null;
  calendarEventId: string | null;
  calendarStatus: 'synced' | 'failed' | null;
  calendarError: ConferencingProblem | null;
  timeZone: string | null;
}

/** Columns a caller may set; anything left out keeps its value. */
export type MeetingConferencingValues = Partial<Omit<MeetingConferencingRow, 'id' | 'meetingId'>>;

const selection = {
  id: contactMeetingConferencing.id,
  meetingId: contactMeetingConferencing.meetingId,
  hostUserId: contactMeetingConferencing.hostUserId,
  videoProvider: contactMeetingConferencing.videoProvider,
  videoMeetingId: contactMeetingConferencing.videoMeetingId,
  videoVia: contactMeetingConferencing.videoVia,
  videoStatus: contactMeetingConferencing.videoStatus,
  videoError: contactMeetingConferencing.videoError,
  addToCalendar: contactMeetingConferencing.addToCalendar,
  sendInvitation: contactMeetingConferencing.sendInvitation,
  calendarProvider: contactMeetingConferencing.calendarProvider,
  calendarId: contactMeetingConferencing.calendarId,
  calendarEventId: contactMeetingConferencing.calendarEventId,
  calendarStatus: contactMeetingConferencing.calendarStatus,
  calendarError: contactMeetingConferencing.calendarError,
  timeZone: contactMeetingConferencing.timeZone,
};

/**
 * Data access for `contact_meeting_conferencing` (BL-361, BL-362): the video link and calendar entry asked for on a typed-in meeting. Owned
 * by the crm module with the meetings it belongs to; the meeting-conferencing module reads and writes it through the crm barrel to record
 * what the provider answered.
 */
@Injectable()
export class ContactMeetingConferencingRepository {
  async findByMeeting(
    tx: Tx,
    orgId: number,
    meetingId: number,
  ): Promise<MeetingConferencingRow | undefined> {
    const rows = await tx
      .select(selection)
      .from(contactMeetingConferencing)
      .where(
        and(
          eq(contactMeetingConferencing.orgId, orgId),
          eq(contactMeetingConferencing.meetingId, meetingId),
        ),
      );
    return rows[0] as MeetingConferencingRow | undefined;
  }

  /** One query for a page of meetings: the rows by meeting id. */
  async findByMeetings(
    tx: Tx,
    orgId: number,
    meetingIds: number[],
  ): Promise<Map<number, MeetingConferencingRow>> {
    if (meetingIds.length === 0) return new Map();
    const rows = (await tx
      .select(selection)
      .from(contactMeetingConferencing)
      .where(
        and(
          eq(contactMeetingConferencing.orgId, orgId),
          inArray(contactMeetingConferencing.meetingId, meetingIds),
        ),
      )) as MeetingConferencingRow[];
    return new Map(rows.map((r) => [r.meetingId, r]));
  }

  /** Creates the row, or sets the given columns of the one that exists. */
  async upsert(
    tx: Tx,
    orgId: number,
    meetingId: number,
    values: MeetingConferencingValues,
  ): Promise<void> {
    await tx
      .insert(contactMeetingConferencing)
      .values({ orgId, meetingId, ...values })
      .onConflictDoUpdate({
        target: [contactMeetingConferencing.orgId, contactMeetingConferencing.meetingId],
        set: { ...values, updatedAt: sql`now()` },
      });
  }
}
