import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ResolveMergeTagResponse } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AttributesRepository } from './attributes.repository';
import { renderMergeTags, type MergeContact, type MergeContext } from './merge-tags';

/**
 * The merge-tag resolver other domains call at send time (broadcasts, campaigns, scheduled
 * sends, flows): ONE precedence and ONE alias table (TW-CON-048), where Reference had two resolvers
 * with opposite answers for an unknown token. Unresolved is always the empty string.
 *
 * Load the per-send context once (`baseContext`), then `render` per recipient with the contact
 * read through `contactFor`; both take the caller's `tx`, so a job passes its tenant transaction.
 */
@Injectable()
export class MergeTagService {
  constructor(private readonly attributes: AttributesRepository) {}

  /** Workspace attribute defaults (active only) and the system tokens. Same for every recipient. */
  async baseContext(tx: Tx, orgId: number): Promise<Omit<MergeContext, 'contact'>> {
    const active = await this.attributes.listActive(tx, orgId);
    const orgName = await this.attributes.orgName(tx, orgId);
    return {
      attributeDefaults: new Map(
        active.map((a) => [
          a.key,
          typeof a.config.defaultValue === 'string' ? a.config.defaultValue : null,
        ]),
      ),
      system: {
        today: new Date().toISOString().slice(0, 10),
        businessName: orgName,
        companyName: orgName,
      },
    };
  }

  async contactFor(tx: Tx, orgId: number, contactId: number): Promise<MergeContact | undefined> {
    const columns = await this.attributes.contactForMerge(tx, orgId, contactId);
    if (!columns) return undefined;
    // group names, in the order the contact card shows them
    const groups = await tx.execute(sql`
      SELECT g.name FROM contact_group_members m
      JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id
      WHERE m.org_id = ${orgId} AND m.contact_id = ${contactId} ORDER BY lower(g.name)
    `);
    return { ...columns, groups: (groups.rows as Array<{ name: string }>).map((r) => r.name) };
  }

  render(
    template: string,
    contact: MergeContact | undefined,
    base: Omit<MergeContext, 'contact'>,
  ): ResolveMergeTagResponse {
    return renderMergeTags(template, { ...base, contact });
  }
}
