import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type MeetingResult,
  type MeetingResultsResponse,
  type SetMeetingResultInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertContactScope, ContactsRepository } from '../contacts';
import { optionRefColumns, optionRefFrom } from './activity-option-ref';
import { ActivityTypesService } from './activity-types.service';

const MEETING_MODULE = 'contact_meetings';

type Raw = Record<string, unknown>;

const RESULT_SELECT = sql`
  SELECT m.uuid AS meeting_uuid, r.note, r.completed_at, r.row_version, u.uuid AS completed_by_uuid,
         ${optionRefColumns('opt', 'act', 'outcome')}
  FROM contact_meeting_outcomes r
  JOIN contact_meetings m ON m.org_id = r.org_id AND m.id = r.meeting_id
  LEFT JOIN users u ON u.org_id = r.org_id AND u.id = r.completed_by
  LEFT JOIN activity_type_options opt ON opt.org_id = r.org_id AND opt.id = r.outcome_id
  LEFT JOIN activity_types act ON act.org_id = opt.org_id AND act.id = opt.activity_type_id
`;

const toResult = (r: Raw): MeetingResult => ({
  meetingId: r.meeting_uuid as string,
  outcome: optionRefFrom(r, 'outcome'),
  note: (r.note as string | null) ?? null,
  completedAt: new Date(r.completed_at as string).toISOString(),
  completedBy: (r.completed_by_uuid as string | null) ?? null,
  rowVersion: Number(r.row_version),
});

/**
 * Completing a meeting: its outcome (from the Meeting activity's list) and notes. Kept beside the meetings, not in them, so the booking
 * mirror stays as it is; a meeting that mirrors a booking can be completed too (the outcome is about the meeting, the booking is untouched).
 */
@Injectable()
export class MeetingResultsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly activities: ActivityTypesService,
    private readonly contactsRepo: ContactsRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async list(contactUuid: string): Promise<MeetingResultsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.requireContact(tx, ctx.orgId, contactUuid, 'record.contacts.read');
      const res = await tx.execute(sql`
        ${RESULT_SELECT}
        WHERE r.org_id = ${ctx.orgId} AND r.contact_id = ${contact.id}
        ORDER BY r.completed_at DESC, r.id DESC
      `);
      return { data: res.rows.map((r) => toResult(r as Raw)) };
    });
  }

  async set(contactUuid: string, meetingUuid: string, input: SetMeetingResultInput): Promise<MeetingResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.requireContact(tx, ctx.orgId, contactUuid, 'record.contacts.update');
      const meeting = await this.requireMeeting(tx, ctx.orgId, contact.id, meetingUuid);
      const settings = await this.activities.settingsOf(tx, ctx.orgId, 'meeting');
      if (!settings.allowComplete) {
        throw new AppError(
          ERROR_CODES.ACTIVITY_COMPLETION_DISABLED,
          'Completing meetings is switched off in Sales Activities.',
          HttpStatus.CONFLICT,
        );
      }
      if (input.completedAt !== undefined && !settings.allowEditCompleted) {
        throw new AppError(
          ERROR_CODES.ACTIVITY_EDIT_COMPLETED_DISABLED,
          'Editing the completed date and time of a meeting is switched off in Sales Activities.',
          HttpStatus.CONFLICT,
        );
      }
      let outcomeId: number | null | undefined;
      if (input.outcomeId === null) outcomeId = null;
      else if (input.outcomeId !== undefined) {
        outcomeId = (await this.activities.resolveOption(tx, ctx.orgId, input.outcomeId, 'outcome', 'meeting')).id;
      }
      const noteGiven = input.note !== undefined;
      const note = input.note ? input.note : null;
      const completedAt = input.completedAt ? new Date(input.completedAt) : null;
      if (completedAt && completedAt.getTime() > Date.now() + 5 * 60_000) {
        throw AppError.validation('A meeting cannot be completed in the future.', [{ path: 'completedAt', message: 'In the future' }]);
      }

      // One row per meeting. A field that is absent keeps what is stored; `null` clears it.
      const res = await tx.execute(sql`
        INSERT INTO contact_meeting_outcomes (org_id, contact_id, meeting_id, outcome_id, note, completed_at, completed_by)
        VALUES (${ctx.orgId}, ${contact.id}, ${meeting.id}, ${outcomeId ?? null}, ${note}, coalesce(${completedAt}, now()), ${ctx.userId})
        ON CONFLICT (org_id, meeting_id) DO UPDATE SET
          outcome_id = CASE WHEN ${outcomeId !== undefined} THEN ${outcomeId ?? null} ELSE contact_meeting_outcomes.outcome_id END,
          note = CASE WHEN ${noteGiven} THEN ${note} ELSE contact_meeting_outcomes.note END,
          completed_at = coalesce(${completedAt}, contact_meeting_outcomes.completed_at),
          completed_by = coalesce(${ctx.userId}, contact_meeting_outcomes.completed_by)
        RETURNING id
      `);
      const resultId = Number((res.rows[0] as Raw).id);
      await this.audit.record(tx, {
        module: MEETING_MODULE,
        recordId: meeting.id,
        action: 'update',
        // The note is free text about a person: the trail records that it was written, not what it says.
        delta: {
          completed: { old: null, new: true },
          ...(outcomeId !== undefined ? { outcomeId: { old: null, new: outcomeId } } : {}),
          ...(noteGiven ? { note: { old: null, new: note !== null } } : {}),
        },
      });
      const out = await tx.execute(sql`${RESULT_SELECT} WHERE r.org_id = ${ctx.orgId} AND r.id = ${resultId}`);
      return toResult(out.rows[0] as Raw);
    });
  }

  /** Reopens the meeting: the outcome and notes are dropped. */
  async clear(contactUuid: string, meetingUuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const contact = await this.requireContact(tx, ctx.orgId, contactUuid, 'record.contacts.update');
      const meeting = await this.requireMeeting(tx, ctx.orgId, contact.id, meetingUuid);
      const res = await tx.execute(sql`
        DELETE FROM contact_meeting_outcomes WHERE org_id = ${ctx.orgId} AND meeting_id = ${meeting.id} RETURNING id
      `);
      if (res.rows.length === 0) return;
      await this.audit.record(tx, {
        module: MEETING_MODULE,
        recordId: meeting.id,
        action: 'update',
        delta: { completed: { old: true, new: false } },
      });
    });
  }

  private async requireContact(tx: Tx, orgId: number, uuid: string, permission: string) {
    const ctx = RequestContextStore.require();
    const ref = await this.contactsRepo.resolveContactRef(tx, orgId, uuid);
    if (!ref) throw AppError.notFound('Contact', uuid);
    const scope = this.rbac.can(ctx.grants!, permission).scope;
    await assertContactScope(tx, this.contactsRepo, orgId, scope, ctx.userId!, ref.ownerId);
    return ref;
  }

  private async requireMeeting(tx: Tx, orgId: number, contactId: number, uuid: string): Promise<{ id: number }> {
    const res = await tx.execute(sql`
      SELECT id FROM contact_meetings WHERE org_id = ${orgId} AND contact_id = ${contactId} AND uuid = ${uuid}
    `);
    const r = res.rows[0] as Raw | undefined;
    if (!r) throw AppError.notFound('ContactMeeting', uuid);
    return { id: Number(r.id) };
  }
}
