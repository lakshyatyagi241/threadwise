import { Injectable, Logger } from '@nestjs/common';
import {
  CONFERENCING_APP_SLUG,
  CONNECTED_VIDEO_PROVIDERS,
  type ConferencingCapabilities,
  type ContactMeetingResponse,
  type ConferencingProblem,
  type ConnectedVideoProvider,
  type MeetingCalendarProvider,
  type VideoVia,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ConferencingError } from '../../infra/providers/meeting-conferencing';
import type { VideoMeetingRequest } from '../../infra/providers/meeting-conferencing';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { MeetingCalendarGateway, type MeetingCalendarOption } from '../appointments-booking';
import {
  assertContactScope,
  toContactMeetingResponse,
  ContactMeetingConferencingRepository,
  ContactMeetingsRepository,
  ContactsRepository,
  type MeetingConferencingPort,
  type MeetingConferencingRow,
  type MeetingConferencingValues,
  type ReleaseSnapshot,
} from '../crm';
import { ConferencingConnectionRepository } from './conferencing-connection.repository';
import { ConferencingTokens, VideoNotConnectedError } from './conferencing-tokens.service';

/** A meeting with no end time is asked for at this length (Zoom and Teams both want an end). */
export const DEFAULT_MEETING_MINUTES = 30;

/** What a failed step is called on the meeting. The web words these in the reader's language. */
export function problemOf(err: unknown): ConferencingProblem {
  if (err instanceof VideoNotConnectedError) {
    switch (err.reason) {
      case 'needs_reconnect':
      case 'scope_missing':
        return 'needs_reconnect';
      case 'not_configured':
        return 'not_configured';
      default:
        return 'not_connected';
    }
  }
  if (err instanceof ConferencingError && err.kind === 'invalid_client') return 'not_configured';
  return 'provider_failed';
}

interface Work {
  meeting: NonNullable<Awaited<ReturnType<ContactMeetingsRepository['findById']>>>;
  conf: MeetingConferencingRow;
  contact: { email: string | null; name: string | null } | null;
}

/**
 * Makes a contact's video link and calendar entry real (BL-360..BL-362), and tells the form which options a person has.
 *
 *  - `capabilities`: the video options are exactly what is INSTALLED (the Marketplace listing) and CONNECTED (the person's own account, or
 *    the workspace's calendar for Meet). Nothing is offered on a guess; the form shows nothing before this says so.
 *  - `provision`: called by the meeting service after the meeting is saved. It never throws: a provider that is down, a revoked grant or a
 *    missing connection is recorded on the row as a short problem code and the meeting stays saved; `retry` runs it again.
 *  - `release`: removes a room or an event the meeting no longer holds (a delete, a change of provider), from the ids the outbox event carries.
 *
 * Google Meet and Teams-through-Outlook are made by the calendar (the room is part of the event), so they need the calendar entry and go
 * through the same seam the appointments use. Zoom, and Teams made in the person's own Microsoft account, are made in the HOST's account
 * (the person who set the provider).
 */
@Injectable()
export class MeetingConferencingService implements MeetingConferencingPort {
  private readonly logger = new Logger(MeetingConferencingService.name);
  private readonly running = new Map<number, Promise<void>>();

  constructor(
    private readonly db: DatabaseService,
    private readonly meetings: ContactMeetingsRepository,
    private readonly confs: ContactMeetingConferencingRepository,
    private readonly contacts: ContactsRepository,
    private readonly connections: ConferencingConnectionRepository,
    private readonly tokens: ConferencingTokens,
    private readonly calendar: MeetingCalendarGateway,
    private readonly rbac: RbacService,
  ) {}

  // --- what the form may offer -------------------------------------------------------------------------------------------

  async capabilities(): Promise<ConferencingCapabilities> {
    const ctx = RequestContextStore.require();
    const slugs = CONNECTED_VIDEO_PROVIDERS.map((p) => CONFERENCING_APP_SLUG[p]);
    const [state, calendars] = await Promise.all([
      this.db.tx(async (tx) => ({
        installed: await this.connections.installedApps(tx, ctx.orgId, slugs),
        published: await this.connections.publishedApps(tx, slugs),
        mine: ctx.userId === null ? [] : await this.connections.listForUser(tx, ctx.orgId, ctx.userId),
      })),
      this.calendar.options(ctx.orgId),
    ]);
    const google = calendars.find((c) => c.provider === 'google') ?? null;
    const microsoft = calendars.find((c) => c.provider === 'microsoft') ?? null;
    // The workspace's calendar is the one a meeting goes on: the write provider, else the first usable one.
    const write = await this.calendar.writeProvider(ctx.orgId);
    const calendar: MeetingCalendarOption | null =
      calendars.find((c) => c.provider === write) ?? calendars[0] ?? null;

    const usable = async (p: ConnectedVideoProvider): Promise<boolean> => {
      if (!state.installed.has(CONFERENCING_APP_SLUG[p])) return false;
      const conn = state.mine.find((c) => c.provider === p);
      if (!conn || conn.status !== 'active') return false;
      return this.tokens.adapter(p).configured();
    };
    const video: ConferencingCapabilities['video'] = [];
    if (await usable('zoom')) video.push({ provider: 'zoom', via: 'app' });
    if (await usable('teams')) video.push({ provider: 'teams', via: 'app' });
    else if (microsoft) video.push({ provider: 'teams', via: 'calendar' });
    if (google) video.push({ provider: 'meet', via: 'calendar' });

    const connectable = (
      await Promise.all(
        CONNECTED_VIDEO_PROVIDERS.map(async (p) =>
          state.installed.has(CONFERENCING_APP_SLUG[p]) && !(await usable(p)) ? p : null,
        ),
      )
    ).filter((p): p is ConnectedVideoProvider => p !== null);
    return {
      video,
      calendar,
      canInstall: ctx.grants ? this.rbac.can(ctx.grants, 'market.apps.install').allowed : false,
      connectable,
      installable: CONNECTED_VIDEO_PROVIDERS.some(
        (p) =>
          state.published.has(CONFERENCING_APP_SLUG[p]) &&
          !state.installed.has(CONFERENCING_APP_SLUG[p]),
      ),
    };
  }

  // --- provisioning --------------------------------------------------------------------------------------------------------

  /** Never throws. Two runs for one meeting are queued behind each other (a double-clicked Retry must not make two rooms). */
  async provision(orgId: number, meetingId: number): Promise<void> {
    const before = this.running.get(meetingId) ?? Promise.resolve();
    const run = before
      .catch(() => undefined)
      .then(() => this.provisionNow(orgId, meetingId))
      .catch((err: unknown) =>
        this.logger.error({ err: String(err), meetingId }, 'meeting conferencing failed unexpectedly'),
      );
    this.running.set(meetingId, run);
    try {
      await run;
    } finally {
      if (this.running.get(meetingId) === run) this.running.delete(meetingId);
    }
  }

  private async load(orgId: number, meetingId: number): Promise<Work | null> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const meeting = await this.meetings.findById(tx, orgId, meetingId);
      const conf = await this.confs.findByMeeting(tx, orgId, meetingId);
      if (!meeting || !conf) return null;
      const contact = await this.contacts.findById(tx, orgId, meeting.contactId);
      return {
        meeting,
        conf,
        contact: contact
          ? {
              email: contact.email,
              name:
                contact.name ?? ([contact.firstName, contact.lastName].filter(Boolean).join(' ') || null),
            }
          : null,
      };
    });
  }

  private async write(
    orgId: number,
    meetingId: number,
    values: MeetingConferencingValues,
    joinUrl?: string | null,
  ): Promise<void> {
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      await this.confs.upsert(tx, orgId, meetingId, values);
      if (joinUrl !== undefined) await this.meetings.setJoinUrl(tx, orgId, meetingId, joinUrl);
    });
  }

  private async provisionNow(orgId: number, meetingId: number): Promise<void> {
    const work = await this.load(orgId, meetingId);
    if (!work) return;
    const { meeting, conf, contact } = work;
    const asked = conf.videoProvider !== null || conf.addToCalendar;
    if (!asked) return;
    const startsAt = meeting.startsAt;
    if (!startsAt) {
      if (conf.videoProvider) {
        await this.write(orgId, meetingId, { videoStatus: 'failed', videoError: 'no_start_time' });
      }
      return;
    }
    const endsAt = meeting.endsAt ?? new Date(startsAt.getTime() + DEFAULT_MEETING_MINUTES * 60_000);
    const timeZone = conf.timeZone ?? 'UTC';

    // --- which way the room is made ---
    let via: VideoVia | null = conf.videoVia;
    let calendarTarget: MeetingCalendarProvider | null = null;
    let videoProblem: ConferencingProblem | null = null;
    if (conf.videoProvider) {
      const decided = await this.decideVia(orgId, conf);
      if (decided.problem) videoProblem = decided.problem;
      else {
        via = decided.via;
        calendarTarget = decided.calendarTarget;
      }
    }

    let joinUrl: string | null | undefined;
    // --- the room, when it is made in the host's own account (Zoom, Teams) ---
    if (conf.videoProvider && via === 'app' && !videoProblem) {
      const provider = conf.videoProvider as ConnectedVideoProvider;
      const request: VideoMeetingRequest = {
        meetingKey: meeting.uuid,
        topic: meeting.title,
        startsAt,
        endsAt,
        timezone: timeZone,
      };
      try {
        if (conf.hostUserId === null) throw new VideoNotConnectedError('none');
        const made = await this.tokens.withToken(orgId, conf.hostUserId, provider, async (token, a) => {
          if (conf.videoMeetingId) {
            try {
              const up = await a.updateMeeting(token, conf.videoMeetingId, request);
              return { providerMeetingId: up.providerMeetingId, joinUrl: up.joinUrl };
            } catch (err) {
              // The room was removed on the provider's side: a new one takes its place.
              if (!(err instanceof ConferencingError) || err.kind !== 'not_found') throw err;
            }
          }
          const created = await a.createMeeting(token, request);
          return { providerMeetingId: created.providerMeetingId, joinUrl: created.joinUrl as string | null };
        });
        joinUrl = made.joinUrl ?? undefined;
        await this.write(
          orgId,
          meetingId,
          {
            videoMeetingId: made.providerMeetingId,
            videoVia: 'app',
            videoStatus: 'ready',
            videoError: null,
          },
          joinUrl,
        );
        if (joinUrl === undefined) joinUrl = meeting.joinUrl;
      } catch (err) {
        videoProblem = problemOf(err);
        this.logger.warn(
          { err: String(err), meeting: meeting.uuid, provider: conf.videoProvider },
          'could not make the video link',
        );
      }
    }
    if (videoProblem && conf.videoProvider) {
      await this.write(orgId, meetingId, { videoStatus: 'failed', videoError: videoProblem });
    }

    // --- the calendar entry (and, for Meet / Outlook Teams, the room inside it) ---
    const wantsCalendar = conf.addToCalendar || (via === 'calendar' && !videoProblem);
    if (!wantsCalendar) return;
    await this.syncCalendar(orgId, {
      work,
      endsAt,
      timeZone,
      calendarTarget,
      createRoom: via === 'calendar' && !videoProblem && conf.videoProvider !== null,
      joinUrl: joinUrl ?? meeting.joinUrl,
      videoProblem,
    });
  }

  /** How the room is to be made, fixed once it exists: a Teams link made through the Microsoft calendar stays there. */
  private async decideVia(
    orgId: number,
    conf: MeetingConferencingRow,
  ): Promise<
    | { problem: ConferencingProblem; via?: undefined; calendarTarget?: undefined }
    | { problem: null; via: VideoVia; calendarTarget: MeetingCalendarProvider | null }
  > {
    const provider = conf.videoProvider!;
    if (provider === 'meet') return { problem: null, via: 'calendar', calendarTarget: 'google' };
    const slug = CONFERENCING_APP_SLUG[provider];
    const installed = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.connections.installedApps(tx, orgId, [slug]),
    );
    const heldBy = conf.videoVia;
    const options = await this.calendar.options(orgId);
    const microsoft = options.some((o) => o.provider === 'microsoft');
    if (provider === 'teams') {
      if (heldBy === 'calendar') {
        return microsoft
          ? { problem: null, via: 'calendar', calendarTarget: 'microsoft' }
          : { problem: 'calendar_not_connected' };
      }
      // Teams in the host's own account when they have connected it (and the workspace installed the app); else the Microsoft calendar.
      const conn =
        conf.hostUserId === null || !installed.has(slug)
          ? null
          : await this.tokens.connection(orgId, conf.hostUserId, 'teams');
      if (conn && conn.status === 'active') return { problem: null, via: 'app', calendarTarget: null };
      if (heldBy !== 'app' && microsoft) {
        return { problem: null, via: 'calendar', calendarTarget: 'microsoft' };
      }
      return { problem: installed.has(slug) ? 'not_connected' : 'not_installed' };
    }
    if (!installed.has(slug)) return { problem: 'not_installed' };
    return { problem: null, via: 'app', calendarTarget: null };
  }

  private async syncCalendar(
    orgId: number,
    a: {
      work: Work;
      endsAt: Date;
      timeZone: string;
      calendarTarget: MeetingCalendarProvider | null;
      createRoom: boolean;
      joinUrl: string | null;
      videoProblem: ConferencingProblem | null;
    },
  ): Promise<void> {
    const { meeting, conf, contact } = a.work;
    const fail = async (problem: ConferencingProblem, alsoVideo: boolean) => {
      await this.write(orgId, meeting.id, {
        calendarStatus: 'failed',
        calendarError: problem,
        ...(alsoVideo ? { videoStatus: 'failed' as const, videoError: problem } : {}),
      });
    };
    try {
      const target = a.calendarTarget ?? conf.calendarProvider ?? (await this.calendar.writeProvider(orgId));
      if (!target) return await fail('calendar_not_connected', a.createRoom);
      let existingEventId = conf.calendarEventId;
      let calendarId = conf.calendarId;
      // The event sits in the other calendar (the workspace changed provider, or Meet needs Google): it is removed there and made again.
      if (existingEventId && conf.calendarProvider && conf.calendarProvider !== target) {
        await this.calendar
          .remove(conf.calendarProvider, orgId, conf.calendarId, existingEventId)
          .catch((err: unknown) =>
            this.logger.warn({ err: String(err), meeting: meeting.uuid }, 'could not remove the event from the previous calendar'),
          );
        existingEventId = null;
        calendarId = null;
      }
      const invitee = conf.sendInvitation ? contact?.email?.trim() || null : null;
      const result = await this.calendar.upsert(target, orgId, {
        meetingKey: meeting.uuid,
        calendarId: target === 'microsoft' ? null : calendarId,
        title: meeting.title,
        description: a.joinUrl && !a.createRoom ? `Join: ${a.joinUrl}` : null,
        location: meeting.location,
        startsAt: meeting.startsAt!,
        endsAt: a.endsAt,
        timezone: a.timeZone,
        attendeeEmail: invitee,
        attendeeName: invitee ? contact?.name ?? null : null,
        createMeet: a.createRoom,
        existingEventId,
      });
      if (!result) return await fail('calendar_not_connected', a.createRoom);
      const values: MeetingConferencingValues = {
        calendarProvider: result.provider,
        calendarId: result.calendarId,
        calendarEventId: result.eventId,
        calendarStatus: 'synced',
        calendarError: null,
        // Marked as asked-for once a Teams link needed the calendar: the toggle in the form then agrees with what happened.
        addToCalendar: true,
      };
      if (a.createRoom) {
        if (result.joinUrl) {
          await this.write(
            orgId,
            meeting.id,
            { ...values, videoVia: 'calendar', videoStatus: 'ready', videoError: null, videoMeetingId: null },
            result.joinUrl,
          );
          return;
        }
        // The calendar wrote the event but made no room (a personal Microsoft account has none): the event stays, the link is a failure.
        await this.write(orgId, meeting.id, {
          ...values,
          videoVia: 'calendar',
          videoStatus: 'failed',
          videoError: 'provider_failed',
        });
        return;
      }
      await this.write(orgId, meeting.id, values);
    } catch (err) {
      this.logger.warn({ err: String(err), meeting: meeting.uuid }, 'could not write the calendar entry');
      await fail('provider_failed', false).catch(() => undefined);
    }
  }

  // --- retry -----------------------------------------------------------------------------------------------------------------

  /**
   * Runs the video link and the calendar entry again for a meeting where one of them failed. The person who presses Retry becomes the host of
   * a room that is still to be made (their account is the one that is connected NOW), and the meeting's contact scope applies as for an edit.
   */
  async retry(contactUuid: string, meetingUuid: string): Promise<ContactMeetingResponse> {
    const ctx = RequestContextStore.require();
    const meetingId = await this.db.tx(async (tx) => {
      const contact = await this.contacts.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!contact) throw AppError.notFound('Contact', contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(tx, this.contacts, ctx.orgId, scope, ctx.userId!, contact.ownerId);
      const meeting = await this.meetings.findByUuid(tx, ctx.orgId, meetingUuid);
      if (!meeting || meeting.contactId !== contact.id) {
        throw AppError.notFound('ContactMeeting', meetingUuid);
      }
      const conf = await this.confs.findByMeeting(tx, ctx.orgId, meeting.id);
      if (!conf || (conf.videoProvider === null && !conf.addToCalendar)) {
        throw AppError.validation('This meeting has no video link or calendar entry to retry.', [
          { path: 'meeting', message: 'nothing_asked' },
        ]);
      }
      const roomMissing = conf.videoProvider !== null && conf.videoMeetingId === null && conf.videoVia !== 'calendar';
      await this.confs.upsert(tx, ctx.orgId, meeting.id, {
        ...(conf.videoStatus === 'failed'
          ? { videoStatus: 'pending' as const, videoError: null, ...(roomMissing ? { hostUserId: ctx.userId } : {}) }
          : {}),
        ...(conf.calendarStatus === 'failed' ? { calendarStatus: null, calendarError: null } : {}),
      });
      return meeting.id;
    });
    await this.provision(ctx.orgId, meetingId);
    return this.db.tx(async (tx) => {
      const row = await this.meetings.findById(tx, ctx.orgId, meetingId);
      const conf = await this.confs.findByMeeting(tx, ctx.orgId, meetingId);
      return toContactMeetingResponse(row!, false, conf);
    });
  }

  // --- release ---------------------------------------------------------------------------------------------------------------

  /**
   * Removes what a meeting no longer holds. Idempotent: a room or event already gone is success. A host who is no longer connected cannot be
   * acted for, so the room is left (it expires on its own; Zoom and Teams rooms are not billed) and that is logged, not retried forever.
   * Anything else throws, and the outbox retries with backoff.
   */
  async release(orgId: number, snapshot: ReleaseSnapshot): Promise<void> {
    if (snapshot.video) {
      const { provider, id } = snapshot.video;
      if (snapshot.hostUserId === null) {
        this.logger.warn({ provider }, 'a video room was left: its host is gone');
      } else {
        try {
          await this.tokens.withToken(orgId, snapshot.hostUserId, provider, (token, a) =>
            a.deleteMeeting(token, id),
          );
        } catch (err) {
          if (err instanceof VideoNotConnectedError) {
            this.logger.warn(
              { provider, reason: err.reason },
              'a video room was left: its host is not connected any more',
            );
          } else if (
            err instanceof ConferencingError &&
            (err.kind === 'forbidden' || err.kind === 'bad_request')
          ) {
            // The provider refused the delete (a tenant policy, an API that does not offer it): retrying will not change that.
            this.logger.warn({ provider, kind: err.kind, reason: err.reason }, 'a video room could not be deleted and was left');
          } else throw err;
        }
      }
    }
    if (snapshot.calendar) {
      const { provider, calendarId, eventId } = snapshot.calendar;
      await this.calendar.remove(provider, orgId, calendarId, eventId);
    }
  }
}
