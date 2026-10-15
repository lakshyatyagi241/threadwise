import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PageResponse, PartnerLeadView, SubmitPartnerLeadInput } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { ContactsService } from '../crm';

interface PartnerLeadRow {
  id: number;
  uuid: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  lifecycle_stage: string | null;
  college_tag: string | null;
  submitted_at: Date;
  updated_at: Date;
}

/**
 * Sub-agent portal.
 *
 * The design decision that shapes this whole file: the partner side
 * stores only the agent -> contact mapping. Name, stage and everything else are
 * read LIVE from the CRM on every view.
 *
 * The alternative — copying stage into the partner's own store and syncing —
 * means two sources of truth for "what stage is this lead in", a sync job that
 * can lag or die, and an agent arguing about commission based on stale data.
 * A live read has none of those failure modes and costs one indexed query.
 *
 * Reads go to the REPLICA. Agents poll; that traffic has no business competing
 * with staff writes on the primary.
 */
@Injectable()
export class PartnerService {
  private readonly logger = new Logger(PartnerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly contacts: ContactsService,
  ) {}

  /**
   * Agent submits a lead.
   *
   * Reuses ContactsService.create, so an agent-submitted lead goes through
   * exactly the same identity resolution, dedup, audit and outbox path as one
   * typed by staff. A parallel "partner lead" write path would drift from the
   * main one within a month.
   */
  async submitLead(input: SubmitPartnerLeadInput): Promise<PartnerLeadView> {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'partner_agent' || !ctx.actorId) {
      throw AppError.forbidden('partner agent context required');
    }
    const agentId = ctx.actorId;

    const contact = await this.contacts.create(
      {
        name: input.name,
        email: input.email,
        phone: input.phone,
        lifecycleStage: 'new',
        consent: input.consent,
        customFields: {
          college_tag: input.collegeTag ?? null,
          program_of_interest: input.programOfInterest ?? null,
          city: input.city ?? null,
          country: input.country ?? null,
          agent_notes: input.notes ?? null,
        },
      },
      // The agent speaks for the person: the grant is theirs to assert, the ledger names the agent as the reference.
      { source: 'api', evidence: { reference: `partner_agent:${agentId}` } },
    );

    await this.db.tx(async (tx) => {
      const idRow = await tx.execute(
        sql`SELECT id FROM contacts WHERE org_id = ${ctx.orgId} AND uuid = ${contact.id}`,
      );
      const contactId = (idRow.rows[0] as { id: number }).id;

      await tx.execute(sql`
        INSERT INTO partner_agent_leads (org_id, agent_id, contact_id, college_tag, submitted_payload)
        VALUES (${ctx.orgId}, ${agentId}, ${contactId}, ${input.collegeTag ?? null}, ${JSON.stringify(input)}::jsonb)
        ON CONFLICT (org_id, agent_id, contact_id) DO NOTHING
      `);

      // Attribution. Set only if unclaimed — the FIRST agent to submit a lead
      // owns it, and a second agent submitting the same person must not
      // silently steal the attribution.
      await tx.execute(sql`
        UPDATE contacts
        SET submitted_by_agent_id = ${agentId}
        WHERE org_id = ${ctx.orgId} AND id = ${contactId} AND submitted_by_agent_id IS NULL
      `);
    });

    this.logger.log({ orgId: ctx.orgId, agentId }, 'partner lead submitted');
    return this.getLead(contact.id);
  }

  /** The agent's own leads. Never anyone else's — the agent id is taken from the token. */
  async listLeads(limit: number, cursor?: string): Promise<PageResponse<PartnerLeadView>> {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'partner_agent' || !ctx.actorId) {
      throw AppError.forbidden('partner agent context required');
    }

    const bound = cursor ? decodeCursor(cursor) : null;

    const result = await this.db.txReplica(async (tx) =>
      tx.execute(sql`
        SELECT c.id, c.uuid, c.name, c.email::text AS email, c.phone,
               c.lifecycle_stage, pal.college_tag, pal.submitted_at, c.updated_at
        FROM partner_agent_leads pal
        JOIN contacts c ON c.org_id = pal.org_id AND c.id = pal.contact_id
        WHERE pal.org_id = ${ctx.orgId}
          AND pal.agent_id = ${ctx.actorId}
          ${bound ? sql`AND (pal.submitted_at, pal.id) < (${bound.createdAt.toISOString()}::timestamptz, ${bound.id})` : sql``}
        ORDER BY pal.submitted_at DESC, pal.id DESC
        LIMIT ${limit + 1}
      `),
    );

    const rows = (result.rows as unknown as PartnerLeadRow[]).map((row) => ({
      ...row,
      createdAt: row.submitted_at,
    }));

    const { items, page } = buildPage(rows, limit);
    return { data: items.map(toPartnerLeadView), page };
  }

  /**
   * One lead, live.
   *
   * The join through partner_agent_leads is the authorisation: an agent can
   * only ever name a contact that is already mapped to them, so there is no
   * "can this agent see this contact" check to forget.
   */
  async getLead(contactUuid: string): Promise<PartnerLeadView> {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'partner_agent' || !ctx.actorId) {
      throw AppError.forbidden('partner agent context required');
    }

    const result = await this.db.txReplica(async (tx) =>
      tx.execute(sql`
        SELECT c.id, c.uuid, c.name, c.email::text AS email, c.phone,
               c.lifecycle_stage, pal.college_tag, pal.submitted_at, c.updated_at
        FROM partner_agent_leads pal
        JOIN contacts c ON c.org_id = pal.org_id AND c.id = pal.contact_id
        WHERE pal.org_id = ${ctx.orgId}
          AND pal.agent_id = ${ctx.actorId}
          AND c.uuid = ${contactUuid}
        LIMIT 1
      `),
    );

    const row = result.rows[0] as unknown as PartnerLeadRow | undefined;
    if (!row) throw AppError.notFound('Lead', contactUuid);
    return toPartnerLeadView(row);
  }
}

function toPartnerLeadView(row: PartnerLeadRow): PartnerLeadView {
  return {
    id: row.uuid,
    name: row.name,
    email: row.email,
    phone: row.phone,
    lifecycleStage: row.lifecycle_stage,
    collegeTag: row.college_tag,
    submittedAt: new Date(row.submitted_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
