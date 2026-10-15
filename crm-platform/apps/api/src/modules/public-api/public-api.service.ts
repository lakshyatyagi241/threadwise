import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PublicLeadRead, PublicLeadSubmitInput } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ContactsService } from '../crm';

interface PublicLeadRow {
  uuid: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  lifecycle_stage: string | null;
  college_tag: string | null;
  updated_at: Date;
}

/**
 * /public/v1 — the external contract.
 *
 * Reads go to the REPLICA, always. This surface exists because external
 * systems poll: a partner backend checking lead stages every minute, a
 * college's system pulling updates. That traffic is unbounded and untrusted,
 * and it has no business sharing capacity with the primary that staff writes
 * depend on.
 *
 * The response shape is frozen independently of internal DTOs. Internal
 * refactors must not break an integration we cannot redeploy.
 */
@Injectable()
export class PublicApiService {
  constructor(
    private readonly db: DatabaseService,
    private readonly contacts: ContactsService,
  ) {}

  async getLead(uuid: string): Promise<PublicLeadRead> {
    const ctx = RequestContextStore.require();

    const result = await this.db.txReplica(async (tx) =>
      tx.execute(sql`
        SELECT uuid, name, email::text AS email, phone,
               lifecycle_stage, data ->> 'college_tag' AS college_tag, updated_at
        FROM contacts
        WHERE org_id = ${ctx.orgId} AND uuid = ${uuid}
        LIMIT 1
      `),
    );

    const row = result.rows[0] as unknown as PublicLeadRow | undefined;
    if (!row) throw AppError.notFound('Lead', uuid);
    return toPublicLead(row);
  }

  /**
   * Lead ingest.
   *
   * Goes through ContactsService so an external submission gets the same
   * identity resolution and dedup as every other entry point — which is why
   * `created` can come back false: the person already existed and was matched
   * rather than duplicated.
   */
  async submitLead(input: PublicLeadSubmitInput): Promise<{ id: string; created: boolean }> {
    const ctx = RequestContextStore.require();

    const before = await this.db.txReplica(async (tx) =>
      tx.execute(sql`
        SELECT contact_id FROM contact_identities
        WHERE org_id = ${ctx.orgId} AND kind = 'email' AND value = ${input.email.toLowerCase()}
        LIMIT 1
      `),
    );
    const existed = before.rows.length > 0;

    const contact = await this.contacts.create(
      {
        name: input.name,
        email: input.email,
        phone: input.mobile,
        consent: input.consent,
        customFields: {
          college_tag: input.collegeTag ?? null,
          source: input.source,
          // Caller's own nomenclature, stored verbatim. The platform never
          // branches on these — they exist so the caller's data comes back out
          // looking the way it went in.
          ...(input.custom ?? {}),
        },
      },
      // The caller (an API key) vouches for the person's agreement; the key is the evidence, the grant's source is `api`.
      {
        source: 'api',
        evidence: { apiKeyId: ctx.actorId === null ? undefined : String(ctx.actorId) },
      },
    );

    return { id: contact.id, created: !existed };
  }
}

function toPublicLead(row: PublicLeadRow): PublicLeadRead {
  return {
    id: row.uuid,
    name: row.name,
    email: row.email,
    mobile: row.phone,
    lifecycleStage: row.lifecycle_stage,
    collegeTag: row.college_tag,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
