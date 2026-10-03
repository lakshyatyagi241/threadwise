import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  SUPP_TICKET_PRIORITIES,
  SUPP_TICKET_STATUSES,
  type CreatePlaybookRequest,
  type OperatorTicketDetail,
  type Playbook,
  type PlaybookStep,
  type PlaybooksResponse,
  type RunnablePlaybooksResponse,
  type SetPlaybookActiveRequest,
  type SuppTicketPriority,
  type SuppTicketStatus,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService } from '../auth';
import { OperatorTicketsService } from './operator-tickets.service';
import { SupportStore } from './support-store';
import { TicketActions, type TicketRow } from './ticket-actions.service';

interface PlaybookRow {
  uuid: string;
  name: string;
  slug: string;
  trigger_type: Playbook['triggerType'];
  trigger_value: string | null;
  steps: PlaybookStep[];
  is_active: boolean;
  use_count: number;
  row_version: number;
}
const COLS = sql`uuid, name, slug, trigger_type, trigger_value, steps, is_active, use_count, row_version`;

const toPlaybook = (r: PlaybookRow): Playbook => ({
  id: r.uuid,
  name: r.name,
  slug: r.slug,
  triggerType: r.trigger_type,
  triggerValue: r.trigger_value,
  steps: r.steps,
  isActive: r.is_active,
  useCount: r.use_count,
  rowVersion: r.row_version,
});

/** Slugified name plus six random hex characters, so two playbooks with the same name get different slugs. */
export const playbookSlug = (name: string, hex = randomBytes(3).toString('hex')): string => {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return `${base || 'playbook'}-${hex}`;
};

/** Playbooks: reusable macros an operator runs on a ticket (TW-SUPP-022..024). Triggers other than manual stay inert (025). */
@Injectable()
export class PlaybooksService {
  constructor(
    private readonly store: SupportStore,
    private readonly actions: TicketActions,
    private readonly tickets: OperatorTicketsService,
    private readonly audit: AuthAuditService,
  ) {}

  async list(): Promise<PlaybooksResponse> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT ${COLS} FROM support_playbooks ORDER BY is_active DESC, use_count DESC, id`,
      );
      const data = (res.rows as unknown as PlaybookRow[]).map(toPlaybook);
      return {
        data,
        kpis: {
          total: data.length,
          active: data.filter((p) => p.isActive).length,
          uses: data.reduce((a, p) => a + p.useCount, 0),
        },
      };
    });
  }

  async runnable(): Promise<RunnablePlaybooksResponse> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT uuid AS id, name, slug FROM support_playbooks
        WHERE is_active AND trigger_type = 'manual' ORDER BY name
      `);
      return { data: res.rows as unknown as RunnablePlaybooksResponse['data'] };
    });
  }

  async create(input: CreatePlaybookRequest): Promise<Playbook> {
    // Rows the builder left empty never reach here (the screen drops them); a step with no action is refused by the schema.
    const steps = input.steps.map((s) => ({ action: s.action, value: s.value }));
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        INSERT INTO support_playbooks (name, slug, trigger_type, trigger_value, steps)
        VALUES (${input.name}, ${playbookSlug(input.name)}, ${input.triggerType}, ${input.triggerValue ?? null},
                ${JSON.stringify(steps)}::jsonb)
        RETURNING ${COLS}
      `);
      await this.audit.record(tx, {
        event: 'platform.support.playbook_created',
        status: 'success',
        payload: { name: input.name, steps: steps.length },
      });
      return toPlaybook(res.rows[0] as unknown as PlaybookRow);
    });
  }

  async setActive(uuid: string, input: SetPlaybookActiveRequest): Promise<Playbook> {
    return this.store.tx(async (tx) => {
      const cur = await tx.execute(
        sql`SELECT row_version FROM support_playbooks WHERE uuid = ${uuid} FOR UPDATE`,
      );
      const row = cur.rows[0] as unknown as { row_version: number } | undefined;
      if (!row) throw AppError.notFound('Playbook', uuid);
      if (row.row_version !== input.rowVersion) throw AppError.rowVersionConflict('Playbook');
      const res = await tx.execute(sql`
        UPDATE support_playbooks SET is_active = ${input.isActive} WHERE uuid = ${uuid} RETURNING ${COLS}
      `);
      await this.audit.record(tx, {
        event: 'platform.support.playbook_toggled',
        status: 'success',
        payload: { playbook: uuid, isActive: input.isActive },
      });
      return toPlaybook(res.rows[0] as unknown as PlaybookRow);
    });
  }

  async remove(uuid: string): Promise<void> {
    await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`DELETE FROM support_playbooks WHERE uuid = ${uuid} RETURNING name`,
      );
      const row = res.rows[0] as unknown as { name: string } | undefined;
      if (!row) throw AppError.notFound('Playbook', uuid);
      await this.audit.record(tx, {
        event: 'platform.support.playbook_deleted',
        status: 'success',
        payload: { name: row.name },
      });
    });
  }

  /**
   * Runs the steps in order on one ticket, in ONE transaction (Reference was not transactional: a failing step kept the
   * earlier messages). Every step goes through the shared ticket actions, so a set_status step stamps resolved_at, a
   * reply step stamps the first response and emails the customer, and add_tag really stores the tag (all three were
   * silently broken in Reference). A step with an invalid value is skipped, the others still apply.
   */
  async run(ticketUuid: string, playbookUuid: string): Promise<OperatorTicketDetail> {
    const operatorId = RequestContextStore.require().actorId;
    if (!operatorId) throw AppError.unauthenticated();
    const emails: Array<{
      t: TicketRow;
      messageId: number;
      status: SuppTicketStatus;
      body: string;
    }> = [];

    await this.store.tx(async (tx) => {
      const pb = await tx.execute(
        sql`SELECT ${COLS} FROM support_playbooks WHERE uuid = ${playbookUuid} FOR UPDATE`,
      );
      const p = pb.rows[0] as unknown as PlaybookRow | undefined;
      if (!p) throw AppError.notFound('Playbook', playbookUuid);
      let t = await this.actions.load(tx, ticketUuid, true);
      if (!p.is_active) {
        throw new AppError(ERROR_CODES.CONFLICT, 'This playbook is paused.', HttpStatus.CONFLICT);
      }
      for (const step of p.steps) {
        const value = (step.value ?? '').trim();
        switch (step.action) {
          case 'set_status':
            if ((SUPP_TICKET_STATUSES as readonly string[]).includes(value)) {
              t = await this.actions.statusIn(tx, t, value as SuppTicketStatus);
            }
            break;
          case 'set_priority':
            if ((SUPP_TICKET_PRIORITIES as readonly string[]).includes(value)) {
              t = await this.actions.priorityIn(tx, t, value as SuppTicketPriority);
            }
            break;
          case 'add_tag':
            if (value) await this.actions.addTagIn(tx, t, value);
            break;
          case 'assign': {
            // An empty value unassigns (as in Reference); an operator who cannot take tickets skips the step.
            if (!value) t = await this.actions.assignIn(tx, t, null);
            else if (await this.actions.resolveAgent(tx, value))
              t = await this.actions.assignIn(tx, t, value);
            break;
          }
          case 'reply':
          case 'note': {
            if (!value) break;
            const isNote = step.action === 'note';
            const saved = await this.actions.replyIn(tx, t, operatorId, value, isNote);
            if (!isNote) {
              emails.push({ t, ...saved, body: value });
              t = {
                ...t,
                status: saved.status,
                first_response_at: t.first_response_at ?? new Date(),
              };
            }
            break;
          }
        }
      }
      await tx.execute(sql`UPDATE support_playbooks SET use_count = use_count + 1 WHERE id = (
        SELECT id FROM support_playbooks WHERE uuid = ${playbookUuid})`);
      await this.actions.audit(tx, t, 'update', { playbookRun: { old: null, new: p.slug } });
      await this.audit.record(tx, {
        event: 'platform.support.playbook_run',
        status: 'success',
        orgId: t.org_id,
        payload: { playbook: playbookUuid, ticket: ticketUuid },
      });
    });

    for (const e of emails) await this.actions.deliverReply(e.t, e, e.body);
    return this.tickets.detail(ticketUuid);
  }
}
