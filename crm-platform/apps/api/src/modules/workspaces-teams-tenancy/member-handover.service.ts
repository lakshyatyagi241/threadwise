import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type WspHandoverInput,
  type WspHandoverPreview,
  type WspHandoverResult,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { OwnerReassignService } from '../crm';
import { AssignmentService } from '../team-inbox-routing-sla';

type Raw = Record<string, unknown>;

/** Open conversations moved by one call; the same bound as a bulk action. */
const CONVERSATIONS_PER_RUN = 200;

const invalid = (message: string, path?: string) =>
  new AppError(
    ERROR_CODES.WSP_REASSIGN_INVALID,
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
    path ? [{ path, message }] : undefined,
  );

/**
 * What happens to a person's owned records and open conversations when they are deactivated (Teams v2, decision D10): the
 * deactivate dialog asks, then calls this BEFORE it deactivates, while the person is still an active member.
 *
 * Nothing here is a second implementation. Contacts and open deals move through the existing owner-reassign batch
 * (`OwnerReassignService.create`: caller's record scope, one audit row and event per record, undo for 14 days); open conversations
 * move through `AssignmentService` (the only writer of the assignee columns). "Leave them" does nothing and is not an error: the
 * work stays with the person, visible to people with the `all` scope, until somebody reassigns it.
 */
@Injectable()
export class MemberHandoverService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rbac: RbacService,
    private readonly reassign: OwnerReassignService,
    private readonly assignment: AssignmentService,
  ) {}

  /** What the person holds and who could take it: their records, open chats, and the active managers of their teams. */
  async preview(memberUuid: string): Promise<WspHandoverPreview> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const person = await this.requirePerson(tx, ctx.orgId, memberUuid);
      const counts = await this.counts(tx, ctx.orgId, person.id);
      const leads = await this.teamLeads(tx, ctx.orgId, person.id);
      return {
        contacts: counts.contacts,
        openDeals: counts.openDeals,
        openConversations: counts.openConversations,
        teamLeads: leads.map((l) => ({ id: l.uuid, fullName: l.fullName, teamName: l.teamName })),
      };
    });
  }

  async run(memberUuid: string, input: WspHandoverInput): Promise<WspHandoverResult> {
    const ctx = RequestContextStore.require();
    if (input.mode === 'leave') {
      return {
        mode: 'leave',
        movedContacts: 0,
        movedDeals: 0,
        movedConversations: 0,
        remaining: 0,
        toUser: null,
      };
    }

    const resolved = await this.db.tx(async (tx) => {
      const person = await this.requirePerson(tx, ctx.orgId, memberUuid);
      const target = await this.resolveTarget(tx, ctx.orgId, person.id, input);
      const counts = await this.counts(tx, ctx.orgId, person.id);
      return { person, target, counts };
    });

    let movedContacts = 0;
    let movedDeals = 0;
    let remaining = 0;
    if (resolved.counts.contacts + resolved.counts.openDeals > 0) {
      const can = this.rbac.can(ctx.grants ?? new Map(), 'record.contacts.update');
      if (!can.allowed) throw AppError.forbidden('record.contacts.update');
      const batch = await this.reassign.create(
        {
          fromUserId: memberUuid,
          target: { kind: 'user', userId: resolved.target.uuid },
          includeDeals: true,
        },
        can.scope,
      );
      movedContacts = batch.movedContacts;
      movedDeals = batch.movedDeals;
      remaining += batch.remaining;
    }

    let movedConversations = 0;
    if (resolved.counts.openConversations > 0) {
      const done = await this.assignment.handOverOpen(ctx.orgId, {
        fromUserId: resolved.person.id,
        toUserUuid: resolved.target.uuid,
        actorUserId: ctx.userId!,
        limit: CONVERSATIONS_PER_RUN,
      });
      movedConversations = done.moved;
      remaining += done.remaining;
    }

    return {
      mode: input.mode,
      movedContacts,
      movedDeals,
      movedConversations,
      remaining,
      toUser: { id: resolved.target.uuid, fullName: resolved.target.fullName },
    };
  }

  // --- internals ------------------------------------------------------------------------------------------------------------------

  private async requirePerson(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; fullName: string }> {
    const res = await tx.execute(
      sql`SELECT id, full_name FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as Raw | undefined;
    if (!row) throw AppError.notFound('Member', uuid);
    return { id: Number(row.id), fullName: String(row.full_name) };
  }

  private async counts(
    tx: Tx,
    orgId: number,
    userId: number,
  ): Promise<{ contacts: number; openDeals: number; openConversations: number }> {
    const res = await tx.execute(sql`
      SELECT (SELECT count(*)::int FROM contacts WHERE org_id = ${orgId} AND owner_id = ${userId}) AS contacts,
             (SELECT count(*)::int FROM deals WHERE org_id = ${orgId} AND owner_user_id = ${userId} AND status = 'open') AS deals,
             (SELECT count(*)::int FROM conversations WHERE org_id = ${orgId} AND assignee_user_id = ${userId}
                AND archived = FALSE AND status = 'open') AS conversations`);
    const r = res.rows[0] as Raw;
    return {
      contacts: Number(r.contacts),
      openDeals: Number(r.deals),
      openConversations: Number(r.conversations),
    };
  }

  /**
   * The managers who could take the work, nearest first: the manager of the person's primary team, then of their other teams.
   * A person who manages the team themself falls back to the manager of its parent, up the tree. Only active people, never the
   * person themself, each once.
   */
  private async teamLeads(
    tx: Tx,
    orgId: number,
    personId: number,
  ): Promise<Array<{ id: number; uuid: string; fullName: string; teamName: string }>> {
    const res = await tx.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT tm.is_primary, t.id AS start_team, t.id AS team_id, t.name AS team_name, t.parent_team_id, t.lead_user_id, 0 AS hop, t.sort AS sort
        FROM team_members tm JOIN teams t ON t.org_id = tm.org_id AND t.id = tm.team_id
        WHERE tm.org_id = ${orgId} AND tm.user_id = ${personId}
        UNION ALL
        SELECT c.is_primary, c.start_team, p.id, c.team_name, p.parent_team_id, p.lead_user_id, c.hop + 1, c.sort
        FROM chain c JOIN teams p ON p.org_id = ${orgId} AND p.id = c.parent_team_id
        WHERE c.hop < 10
      )
      SELECT DISTINCT ON (u.id) u.id, u.uuid, u.full_name, c.team_name, c.is_primary, c.hop, c.sort
      FROM chain c
      JOIN users u ON u.org_id = ${orgId} AND u.id = c.lead_user_id AND u.status = 'active'
      WHERE u.id <> ${personId}
      ORDER BY u.id, c.is_primary DESC, c.hop ASC`);
    const rows = (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      uuid: String(r.uuid),
      fullName: String(r.full_name),
      teamName: String(r.team_name),
      primary: Boolean(r.is_primary),
      hop: Number(r.hop),
      sort: Number(r.sort),
    }));
    // DISTINCT ON keeps the best row per person; now order the people: primary team first, then nearest manager.
    rows.sort((a, b) => Number(b.primary) - Number(a.primary) || a.hop - b.hop || a.sort - b.sort);
    return rows;
  }

  private async resolveTarget(
    tx: Tx,
    orgId: number,
    personId: number,
    input: WspHandoverInput,
  ): Promise<{ id: number; uuid: string; fullName: string }> {
    if (input.mode === 'person') {
      const res = await tx.execute(sql`
        SELECT id, uuid, full_name FROM users
        WHERE org_id = ${orgId} AND uuid = ${input.userId!}::uuid AND status = 'active'`);
      const row = res.rows[0] as Raw | undefined;
      if (!row) throw invalid('Choose an active member to take over.', 'userId');
      if (Number(row.id) === personId) throw invalid('Choose somebody else.', 'userId');
      return { id: Number(row.id), uuid: String(row.uuid), fullName: String(row.full_name) };
    }
    const leads = await this.teamLeads(tx, orgId, personId);
    const first = leads[0];
    if (!first) throw invalid('This person has no team manager to take over. Choose a person.');
    return { id: first.id, uuid: first.uuid, fullName: first.fullName };
  }
}
