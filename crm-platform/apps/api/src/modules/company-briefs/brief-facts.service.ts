import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  listDealsQuerySchema,
  listTasksQuerySchema,
  type CompanyResponse,
  type RecordScope,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { MemberDirectory } from '../../realtime';
import {
  CompaniesRepository,
  CompaniesService,
  DealsService,
  TasksService,
  contactScopeCondition,
} from '../crm';
import { visibleToSql } from '../team-inbox-conversations';
import {
  BRIEF_LIST_MAX,
  BRIEF_NOTES_MAX,
  BRIEF_PROPERTIES_MAX,
  BRIEF_TITLE_MAX,
  BRIEF_VALUE_MAX,
  dayOf,
  maskPersonalText,
  type BriefFacts,
} from './brief-rules';

const PERM_CONVERSATIONS = 'inbox.conversation.read';

/** A stored property value as a short line: a list joined, a checkbox as yes, anything long cut. */
function valueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return '';
  return String(value);
}

/**
 * The facts a company's brief is written from (BL-194). Everything is read as the person who asks, through the same services and record
 * scopes as the screens: a company outside their scope is a 404, a kind of record they may not read is left out (and said so in
 * `sources`), and the contacts, deals, tasks and conversations counted are those their scope shows them.
 *
 * What is NOT read at all: a contact's name, email, phone or address, the text of any message, and the company's email, phone and
 * address. Short texts that remain (a deal or task title, the company's notes, a property value) are masked of emails and numbers
 * (`maskPersonalText`) and cut. The result is data for a prompt, never shown as is.
 */
@Injectable()
export class BriefFactsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rbac: RbacService,
    private readonly companies: CompaniesService,
    private readonly companiesRepo: CompaniesRepository,
    private readonly deals: DealsService,
    private readonly tasks: TasksService,
    private readonly members: MemberDirectory,
  ) {}

  async gather(
    uuid: string,
    scope: RecordScope,
  ): Promise<{ companyId: number; companyName: string; facts: BriefFacts }> {
    const ctx = RequestContextStore.require();
    const grants = ctx.grants;
    if (!grants || !ctx.userId) throw AppError.forbidden('record.companies.read');

    // The company itself, inside the caller's scope (404 outside it, as everywhere).
    const company = await this.companies.get(uuid, scope);
    const defs = this.rbac.can(grants, 'record.company-properties.read').allowed
      ? await this.db.tx((tx) => this.companiesRepo.propertyDefs(tx, ctx.orgId))
      : [];
    const companyId = await this.db.tx(async (tx) => {
      const row = await this.companiesRepo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Company', uuid);
      return row.id;
    });

    const contactsRead = this.rbac.can(grants, 'record.contacts.read');
    const contactScope = contactsRead.allowed
      ? contactScopeCondition(ctx.orgId, contactsRead.scope, ctx.userId)
      : undefined;

    const facts: BriefFacts = {
      company: {
        name: maskPersonalText(company.name, BRIEF_TITLE_MAX * 2),
        industry: company.industry ? maskPersonalText(company.industry, 100) : null,
        size: company.sizeRange ? maskPersonalText(company.sizeRange, 40) : null,
        createdOn: dayOf(company.createdAt),
        hasOwner: company.owner !== null,
      },
      properties: this.properties(company, defs),
      notes: company.notes ? maskPersonalText(company.notes, BRIEF_NOTES_MAX) || null : null,
      contacts: contactsRead.allowed ? await this.contacts(companyId, contactScope) : null,
      deals: await this.dealsOf(uuid, company, grants),
      tasks: await this.tasksOf(uuid, grants),
      conversations: contactsRead.allowed
        ? await this.conversationsOf(companyId, contactScope)
        : null,
    };
    return { companyId, companyName: company.name, facts };
  }

  /** The workspace's company properties the person may see, as `label: value` (a hidden or masked property is never sent). */
  private properties(
    company: CompanyResponse,
    defs: Awaited<ReturnType<CompaniesRepository['propertyDefs']>>,
  ): BriefFacts['properties'] {
    const out: BriefFacts['properties'] = [];
    for (const d of defs) {
      if (!d.isActive || d.isHidden || d.isMasked || d.isSystem || d.fieldType === 'formula')
        continue;
      const text = maskPersonalText(valueText(company.customFields[d.key]), BRIEF_VALUE_MAX);
      if (text === '') continue;
      out.push({ label: maskPersonalText(d.label, 60), value: text });
      if (out.length >= BRIEF_PROPERTIES_MAX) break;
    }
    return out;
  }

  private async contacts(companyId: number, scope: ReturnType<typeof contactScopeCondition>) {
    const ctx = RequestContextStore.require();
    const where = scope ? sql` AND ${scope}` : sql``;
    const rows = await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT contacts.lifecycle_stage AS stage, count(*)::int AS n, max(contacts.last_activity_at) AS last_at
        FROM contacts
        WHERE contacts.org_id = ${ctx.orgId} AND contacts.company_id = ${companyId} AND contacts.is_archived = false${where}
        GROUP BY contacts.lifecycle_stage
      `);
      return res.rows as Array<{ stage: string | null; n: number; last_at: Date | string | null }>;
    });
    const byStage: Record<string, number> = {};
    let total = 0;
    let last: number | null = null;
    for (const r of rows) {
      byStage[maskPersonalText(r.stage ?? 'none', 40)] = Number(r.n);
      total += Number(r.n);
      const at = r.last_at ? new Date(r.last_at).getTime() : null;
      if (at !== null && (last === null || at > last)) last = at;
    }
    return {
      total,
      byStage,
      lastActivityOn: last === null ? null : new Date(last).toISOString().slice(0, 10),
    };
  }

  private async dealsOf(
    companyUuid: string,
    company: CompanyResponse,
    grants: NonNullable<ReturnType<typeof RequestContextStore.require>['grants']>,
  ): Promise<BriefFacts['deals']> {
    const read = this.rbac.can(grants, 'record.deals.read');
    const rollup = company.rollup.deals;
    if (!read.allowed || rollup === null) return null;
    const page = await this.deals.list(
      listDealsQuerySchema.parse({ companyId: companyUuid, limit: BRIEF_LIST_MAX }),
      read.scope,
    );
    return {
      open: rollup.open,
      won: rollup.won,
      lost: Math.max(0, rollup.total - rollup.open - rollup.won),
      openValue: rollup.openValue.map((m) => ({ currency: m.currency, amount: m.amount })),
      wonValue: rollup.wonValue.map((m) => ({ currency: m.currency, amount: m.amount })),
      recent: page.data.map((d) => ({
        title: maskPersonalText(d.title, BRIEF_TITLE_MAX),
        stage: maskPersonalText(d.stage.name, 60),
        status: d.status,
        value: d.value,
        currency: d.currency,
        expectedCloseOn: d.expectedCloseDate,
        updatedOn: dayOf(d.updatedAt),
      })),
    };
  }

  private async tasksOf(
    companyUuid: string,
    grants: NonNullable<ReturnType<typeof RequestContextStore.require>['grants']>,
  ): Promise<BriefFacts['tasks']> {
    const read = this.rbac.can(grants, 'record.tasks.read');
    if (!read.allowed) return null;
    const page = await this.tasks.list(
      listTasksQuerySchema.parse({ companyId: companyUuid, status: 'open', limit: 50 }),
      read.scope,
    );
    return {
      open: page.data.length,
      overdue: page.data.filter((t) => t.overdue).length,
      next: page.data.slice(0, BRIEF_LIST_MAX).map((t) => ({
        title: maskPersonalText(t.title, BRIEF_TITLE_MAX),
        dueOn: dayOf(t.dueAt),
        priority: t.priority,
        overdue: t.overdue,
      })),
    };
  }

  /**
   * How much conversation there is with the company's contacts, by the inbox visibility rule of the person (`visibleToSql`): counts and
   * the date of the last message, never a word of any message. Left out when they may not read conversations.
   */
  private async conversationsOf(
    companyId: number,
    contactScope: ReturnType<typeof contactScopeCondition>,
  ): Promise<BriefFacts['conversations']> {
    const ctx = RequestContextStore.require();
    const viewer = await this.members.viewer(ctx.orgId, ctx.userId!, PERM_CONVERSATIONS);
    if (viewer.scope === null) return null;
    const scope = contactScope ? sql` AND ${contactScope}` : sql``;
    const row = await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT count(*)::int AS total,
               (count(*) FILTER (WHERE c.inbox_status = 'open'))::int AS open,
               max(c.last_message_at) AS last_at
        FROM conversations c
        WHERE c.org_id = ${ctx.orgId}
          AND c.contact_id IN (
            SELECT contacts.id FROM contacts
            WHERE contacts.org_id = ${ctx.orgId} AND contacts.company_id = ${companyId} AND contacts.is_archived = false${scope})
          AND ${visibleToSql(viewer, 'c')}
      `);
      return res.rows[0] as { total: number; open: number; last_at: Date | string | null };
    });
    return {
      total: Number(row.total),
      open: Number(row.open),
      lastMessageOn: row.last_at ? new Date(row.last_at).toISOString().slice(0, 10) : null,
    };
  }
}
