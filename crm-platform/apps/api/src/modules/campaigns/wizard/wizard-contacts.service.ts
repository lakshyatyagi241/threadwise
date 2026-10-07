import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  SegmentGroup,
  WizardContactRow,
  WizardContactsPage,
  WizardContactsQuery,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  collectRuleRefs,
  compileRules,
  contactConditions,
  countWithTimeout,
  loadRuleContext,
  whereOf,
} from '../../crm';
import { VALID_NUMBER } from './wizard-audience.service';

/**
 * The contacts table of the audience step ("Broadcast to contacts"): the workspace's contacts, searched and filtered ON THE SERVER with
 * the segments rule engine (the same compiler a segment and the audience use), paged, with the total. Opted-out contacts and contacts
 * without a usable number are listed but flagged `sendable: false`, so the person sees why they cannot be ticked.
 */
@Injectable()
export class WizardContactsService {
  constructor(private readonly db: DatabaseService) {}

  async page(q: WizardContactsQuery): Promise<WizardContactsPage> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      let segment: SQL | undefined;
      if (q.rules) {
        const rules = q.rules as unknown as SegmentGroup;
        const rc = await loadRuleContext(tx, orgId, collectRuleRefs(rules));
        segment = compileRules(orgId, rules, rc).where;
      }
      const where = whereOf(
        contactConditions(
          orgId,
          { includeArchived: false, tagMode: 'any', q: q.search || undefined, segment },
          undefined,
        ),
      );
      const total = await countWithTimeout(tx, where);
      const res = await tx.execute(sql`
        SELECT contacts.uuid, contacts.name, contacts.first_name, contacts.last_name, contacts.email::text AS email,
               contacts.phone, contacts.is_unsubscribed AS opted_out, (${VALID_NUMBER}) AS valid
        FROM contacts WHERE ${where}
        ORDER BY contacts.id DESC LIMIT ${q.perPage} OFFSET ${(q.page - 1) * q.perPage}`);
      const data = (
        res.rows as Array<{
          uuid: string;
          name: string | null;
          first_name: string | null;
          last_name: string | null;
          email: string | null;
          phone: string | null;
          opted_out: boolean;
          valid: boolean;
        }>
      ).map((r): WizardContactRow => ({
        id: r.uuid,
        name: r.name,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        phone: r.phone,
        optedOut: r.opted_out,
        sendable: !r.opted_out && r.valid,
      }));
      return {
        data,
        total: total.count,
        approximate: total.approximate,
        page: q.page,
        perPage: q.perPage,
      };
    });
  }
}
