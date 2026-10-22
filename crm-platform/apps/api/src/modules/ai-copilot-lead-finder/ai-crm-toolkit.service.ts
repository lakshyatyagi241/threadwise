import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, type RecordScope } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import type {
  AiCrmToolDef,
  AiCrmToolCallResult,
} from '../../infra/providers/ai-copilot-lead-finder/ai-crm-provider.port';
import {
  ChannelsFacade,
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
} from '../chat-conversations';
import {
  ContactsService,
  DealsService,
  PipelinesService,
  CompaniesService,
  TasksService,
  InvoicesService,
  PaymentsService,
  SalesDocsService,
} from '../crm';
import { CompanyBriefsService } from '../company-briefs';
import { MembersService } from '../workspaces-teams-tenancy';

const READ_TOOLS = [
  'find_contact',
  'list_deals',
  'find_company',
  'generate_brief',
  'sales_report',
  'list_outstanding',
  'list_my_tasks',
  'revenue_report',
  'list_quotes',
] as const;

const WRITE_TOOLS = [
  'create_contact',
  'create_deal',
  'move_deal_stage',
  'create_company',
  'link_contact_company',
  'create_invoice',
  'record_payment',
  'create_task',
  'assign_task',
  'complete_task',
  'create_quote',
  'send_message',
  'send_quote',
] as const;

export type AiCrmToolName = (typeof READ_TOOLS)[number] | (typeof WRITE_TOOLS)[number];

/**
 * The AI CRM Copilot's tool registry (TW-AICRM-003..011): provider-neutral definitions plus a handler per tool,
 * each calling the CRM domain's own application service (never a repository), so RBAC, audit and outbox stay
 * intact. Read tools run autonomously; write tools are flagged `write` so the provider adapter stops at the call
 * and the copilot service enforces confirm-before-act — this class never decides that, only executes.
 *
 * `generate_brief` (BL-194) writes the AI brief of a company through `CompanyBriefsService`, as the signed-in member: the same
 * record scopes, privacy rules and rate limits as the button on the company page. Reference's `create_project`/`list_projects`
 * tools are not registered: no Projects domain exists in this repo yet.
 */
@Injectable()
export class AiCrmToolkitService {
  constructor(
    private readonly db: DatabaseService,
    private readonly contacts: ContactsService,
    private readonly deals: DealsService,
    private readonly pipelines: PipelinesService,
    private readonly companies: CompaniesService,
    private readonly tasks: TasksService,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly salesDocs: SalesDocsService,
    private readonly members: MembersService,
    private readonly channels: ChannelsFacade,
    private readonly rbac: RbacService,
    private readonly briefs: CompanyBriefsService,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  definitions(): AiCrmToolDef[] {
    return [
      {
        name: 'find_contact',
        description:
          'Search CRM contacts by name or phone number. Returns matching contacts with their phone.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'A name fragment or phone number to search for.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'create_contact',
        description:
          'Create a new CRM contact (or return the existing one if the phone already exists).',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Full name.' },
            phone: { type: 'string', description: 'Phone number, international format preferred.' },
          },
          required: ['name', 'phone'],
        },
      },
      {
        name: 'list_deals',
        description:
          'List deals in the sales pipeline, optionally filtered by status (open/won/lost).',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['open', 'won', 'lost', 'any'],
              description: 'Filter by status. Default open.',
            },
            limit: { type: 'integer', description: 'Max rows (default 15, max 50).' },
          },
        },
      },
      {
        name: 'create_deal',
        description:
          'Create a new deal on the sales pipeline. Optionally attach it to a contact by phone and set a value.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Deal name/title.' },
            value: {
              type: 'number',
              description: 'Deal value in the pipeline currency (major units, e.g. 15000).',
            },
            contact_phone: {
              type: 'string',
              description: 'Optional phone of the contact to link.',
            },
            stage: {
              type: 'string',
              description: "Optional stage name; defaults to the pipeline's first stage.",
            },
          },
          required: ['title'],
        },
      },
      {
        name: 'move_deal_stage',
        description:
          'Move an existing deal to a different pipeline stage (e.g. to mark it won or lost).',
        parameters: {
          type: 'object',
          properties: {
            deal_id: {
              type: 'string',
              description: 'The deal id to move (as returned by list_deals/create_deal).',
            },
            stage: {
              type: 'string',
              description: 'Target stage name fragment (e.g. "Won", "Proposal").',
            },
          },
          required: ['deal_id', 'stage'],
        },
      },
      {
        name: 'find_company',
        description: 'Search companies/organizations by name.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'A company name fragment.' } },
          required: ['query'],
        },
      },
      {
        name: 'generate_brief',
        description:
          'Write an AI account brief of a company by name: who they are, deals, tasks, conversation activity, risks and next steps, from the CRM data you can see. Companies only.',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string', description: 'The company name.' } },
          required: ['name'],
        },
      },
      {
        name: 'create_company',
        description: 'Create a new company/organization.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Company name.' },
            industry: { type: 'string', description: 'Optional industry.' },
          },
          required: ['name'],
        },
      },
      {
        name: 'link_contact_company',
        description:
          'Link an existing contact (by phone) to a company (by name). Creates the company if it does not exist.',
        parameters: {
          type: 'object',
          properties: {
            contact_phone: { type: 'string', description: 'Phone of the contact to link.' },
            company_name: { type: 'string', description: 'Company name to link the contact to.' },
          },
          required: ['contact_phone', 'company_name'],
        },
      },
      {
        name: 'sales_report',
        description:
          'Get a sales summary: open pipeline value, weighted forecast, deals won this month, win rate.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'create_invoice',
        description: 'Create (and issue) an invoice for a customer with one or more line items.',
        parameters: {
          type: 'object',
          properties: {
            buyer_name: { type: 'string', description: 'Customer / bill-to name.' },
            buyer_phone: { type: 'string', description: 'Optional customer phone.' },
            items: {
              type: 'array',
              description: 'Line items.',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  qty: { type: 'number' },
                  unit_price: { type: 'number', description: 'Price per unit in major units.' },
                },
                required: ['description', 'unit_price'],
              },
            },
          },
          required: ['buyer_name', 'items'],
        },
      },
      {
        name: 'record_payment',
        description: 'Record a payment received against an invoice.',
        parameters: {
          type: 'object',
          properties: {
            invoice_number: {
              type: 'string',
              description: 'The invoice number to apply the payment to, e.g. INV-0042.',
            },
            amount: {
              type: 'number',
              description: 'Amount received, in the invoice currency major units.',
            },
            method: {
              type: 'string',
              description: 'cash|bank|card|upi|cheque|other. Default bank.',
            },
          },
          required: ['invoice_number', 'amount'],
        },
      },
      {
        name: 'list_outstanding',
        description: 'List unpaid/partly-paid invoices and the total outstanding, by contact.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'create_task',
        description:
          'Create a follow-up task / to-do with an optional due date, priority and assignee.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'What needs doing.' },
            due_at: { type: 'string', description: 'Optional due date, YYYY-MM-DD.' },
            priority: { type: 'string', description: 'low|medium|high.' },
            assignee_name: {
              type: 'string',
              description: 'Optional workspace member to assign to (by name).',
            },
          },
          required: ['title'],
        },
      },
      {
        name: 'assign_task',
        description: 'Assign an existing task (by id) to a workspace member (by name).',
        parameters: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'Task id (as returned by list_my_tasks/create_task).',
            },
            assignee_name: { type: 'string', description: 'Member name to assign to.' },
          },
          required: ['task_id', 'assignee_name'],
        },
      },
      {
        name: 'complete_task',
        description: 'Mark a task (by id) as done.',
        parameters: {
          type: 'object',
          properties: { task_id: { type: 'string', description: 'Task id.' } },
          required: ['task_id'],
        },
      },
      {
        name: 'list_my_tasks',
        description: 'List the open tasks for the current staff member (soonest due first).',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'revenue_report',
        description: 'Get a money summary: collected (30 days + all time) and outstanding.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'create_quote',
        description:
          'Create a proposal or estimate (priced quote) with line items. Returns a shareable public link. Use doc_type "proposal" for a pitch, "estimate" for a quick quote.',
        parameters: {
          type: 'object',
          properties: {
            doc_type: { type: 'string', description: 'proposal|estimate.' },
            title: { type: 'string', description: 'Short title, e.g. "Website redesign".' },
            buyer_name: { type: 'string', description: 'Optional buyer/customer name.' },
            buyer_phone: {
              type: 'string',
              description: 'Optional buyer phone, needed to send it over WhatsApp later.',
            },
            items: {
              type: 'array',
              description: 'Line items.',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  qty: { type: 'number' },
                  unit_price: { type: 'number' },
                },
                required: ['description', 'unit_price'],
              },
            },
          },
          required: ['doc_type', 'items'],
        },
      },
      {
        name: 'list_quotes',
        description: 'List recent proposals/estimates with their status and total.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'send_message',
        description:
          "Send a plain WhatsApp text message to a customer through the workspace's own connected WhatsApp number. Give either a phone number or the name of an existing contact.",
        parameters: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Phone number (digits) OR an existing contact name.',
            },
            message: { type: 'string', description: 'The text to send.' },
          },
          required: ['to', 'message'],
        },
      },
      {
        name: 'send_quote',
        description:
          'Send an existing proposal or estimate to its buyer over WhatsApp (the public accept link). Identify it by its number, e.g. EST-0001.',
        parameters: {
          type: 'object',
          properties: {
            number: { type: 'string', description: 'The quote number, e.g. EST-0001 or PRO-0002.' },
          },
          required: ['number'],
        },
      },
    ];
  }

  kindOf(tool: string): 'read' | 'write' | undefined {
    if ((READ_TOOLS as readonly string[]).includes(tool)) return 'read';
    if ((WRITE_TOOLS as readonly string[]).includes(tool)) return 'write';
    return undefined;
  }

  async execute(tool: string, args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    try {
      switch (tool as AiCrmToolName) {
        case 'find_contact':
          return await this.findContact(args);
        case 'create_contact':
          return await this.createContact(args);
        case 'list_deals':
          return await this.listDeals(args);
        case 'create_deal':
          return await this.createDeal(args);
        case 'move_deal_stage':
          return await this.moveDealStage(args);
        case 'find_company':
          return await this.findCompany(args);
        case 'generate_brief':
          return await this.generateBrief(args);
        case 'create_company':
          return await this.createCompany(args);
        case 'link_contact_company':
          return await this.linkContactCompany(args);
        case 'sales_report':
          return await this.salesReport();
        case 'create_invoice':
          return await this.createInvoice(args);
        case 'record_payment':
          return await this.recordPayment(args);
        case 'list_outstanding':
          return await this.listOutstanding();
        case 'create_task':
          return await this.createTask(args);
        case 'assign_task':
          return await this.assignTask(args);
        case 'complete_task':
          return await this.completeTask(args);
        case 'list_my_tasks':
          return await this.listMyTasks();
        case 'revenue_report':
          return await this.revenueReport();
        case 'create_quote':
          return await this.createQuote(args);
        case 'list_quotes':
          return await this.listQuotes();
        case 'send_message':
          return await this.sendMessage(args);
        case 'send_quote':
          return await this.sendQuote(args);
        default:
          return { ok: false, summary: `Unknown tool: ${tool}`, data: {} };
      }
    } catch (err) {
      // A permission denial reads differently than a transient failure — the caller can't "just retry" past it,
      // and the audit log should show it as a denial, not a generic error (both still land in a FAILED result
      // the provider adapter never silently swallows — the write was never executed either way).
      if (err instanceof AppError && err.code === ERROR_CODES.FORBIDDEN) {
        return {
          ok: false,
          summary: `You don't have permission to do that (${err.message}).`,
          data: {},
        };
      }
      return {
        ok: false,
        summary: `Tool failed: ${String(err instanceof Error ? err.message : err)}`,
        data: {},
      };
    }
  }

  // ---- scope helper --------------------------------------------------------------------------------------------

  /**
   * The scope for an underlying CRM permission the Copilot is about to use on the caller's behalf — AND, unlike a
   * bare scope lookup, the actual authorization decision. `aicrm.copilot.use` lets someone chat with the Copilot;
   * it is not a blanket grant of every permission the toolkit happens to wrap. A manager given the chat but denied,
   * say, `record.invoices.create` must get the same 403 here that `POST /invoices` would give them directly —
   * otherwise the chat path would silently bypass the same RBAC check every other route enforces.
   */
  private scopeFor(permission: string): RecordScope {
    const ctx = RequestContextStore.require();
    const { allowed, scope } = this.rbac.can(ctx.grants ?? new Map(), permission);
    if (!allowed) throw AppError.forbidden(permission);
    return scope;
  }

  private str(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
  }
  private num(v: unknown): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0;
  }

  // ---- contacts -------------------------------------------------------------------------------------------------

  private async findContact(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    const query = this.str(args.query);
    if (!query) return { ok: false, summary: 'Empty search query.', data: {} };
    const found = await this.contacts.selectData(
      { q: query, limit: 10 },
      this.scopeFor('record.contacts.read'),
    );
    // A contact under a legal hold (BL-295) is restricted from AI processing: the model is never shown them.
    const rows = await this.withoutHeld(found);
    return {
      ok: true,
      summary: `${rows.length} contact(s) found for "${query}".`,
      data: { contacts: rows },
    };
  }

  /** Drops the contacts that are under a legal hold from a picker result before it goes to the model. */
  private async withoutHeld<T extends { id: string }>(rows: T[]): Promise<T[]> {
    if (rows.length === 0) return rows;
    const ctx = RequestContextStore.require();
    const held = await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT c.uuid FROM contacts c
         WHERE c.org_id = ${ctx.orgId} AND c.uuid = ANY(${`{${rows.map((r) => r.id).join(',')}}`}::uuid[])
           AND is_subject_held(c.org_id, 'contact', c.id)`);
      return new Set((res.rows as Array<{ uuid: string }>).map((r) => r.uuid));
    });
    return rows.filter((r) => !held.has(r.id));
  }

  private async createContact(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    this.scopeFor('record.contacts.create');
    const name = this.str(args.name);
    const phone = this.str(args.phone);
    if (!phone) return { ok: false, summary: 'A valid phone number is required.', data: {} };
    const ctx = RequestContextStore.require();
    const resolved = await this.db.tx((tx) =>
      this.contacts.resolveOrCreateByIdentity(tx, ctx.orgId, {
        kind: 'phone',
        value: phone,
        name: name || null,
      }),
    );
    if (resolved.outcome === 'quota_reached')
      return { ok: false, summary: "This workspace's contact limit is reached.", data: {} };
    if (resolved.outcome === 'unusable')
      return { ok: false, summary: 'That is not a usable phone number.', data: {} };
    return {
      ok: true,
      summary: `Contact "${name || 'contact'}" saved.`,
      data: { contact_id: resolved.uuid },
      subjectType: 'contact',
      subjectId: resolved.contactId,
    };
  }

  // ---- deals / pipeline -------------------------------------------------------------------------------------------

  private async resolveStage(
    pipelineUuid: string,
    nameFragment: string,
  ): Promise<{ id: string } | undefined> {
    if (!nameFragment) return undefined;
    const pipeline = await this.pipelines.get(pipelineUuid);
    const match = pipeline.stages.find((s) =>
      s.name.toLowerCase().includes(nameFragment.toLowerCase()),
    );
    return match ? { id: match.id } : undefined;
  }

  private async defaultPipeline(): Promise<{ id: string } | undefined> {
    const pipelines = await this.pipelines.list();
    return pipelines.find((p) => p.isDefault) ?? pipelines[0];
  }

  private async listDeals(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    const status = this.str(args.status).toLowerCase() || 'open';
    const limit = Math.min(50, Math.max(1, Math.trunc(this.num(args.limit)) || 15));
    const scope = this.scopeFor('record.deals.read');
    const result = await this.deals.list(
      {
        status: status === 'any' ? undefined : (status as 'open' | 'won' | 'lost'),
        limit,
        order: 'desc',
      },
      scope,
    );
    const rows = result.data.map((d) => ({
      id: d.id,
      title: d.title,
      value: d.value,
      currency: d.currency,
      status: d.status,
      stage: d.stage.name,
    }));
    return {
      ok: true,
      summary: `${rows.length} ${status === 'any' ? '' : status + ' '}deal(s).`,
      data: { deals: rows },
    };
  }

  private async createDeal(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    this.scopeFor('record.deals.create');
    const title = this.str(args.title) || 'New deal';
    const value = this.num(args.value);
    const phone = this.str(args.contact_phone);
    const stageName = this.str(args.stage);
    const ctx = RequestContextStore.require();

    const pipeline = await this.defaultPipeline();
    if (!pipeline) return { ok: false, summary: 'No sales pipeline is set up.', data: {} };
    const stage = await this.resolveStage(pipeline.id, stageName);

    let contactId: string | undefined;
    if (phone) {
      // resolveOrCreateByIdentity can CREATE a contact as a side effect of linking one to this deal — same
      // permission as the explicit create_contact tool, checked before any contact can be minted this way.
      this.scopeFor('record.contacts.create');
      const resolved = await this.db.tx((tx) =>
        this.contacts.resolveOrCreateByIdentity(tx, ctx.orgId, { kind: 'phone', value: phone }),
      );
      if (resolved.outcome === 'found' || resolved.outcome === 'created') contactId = resolved.uuid;
    }

    const deal = await this.deals.create({
      title,
      pipelineId: pipeline.id,
      stageId: stage?.id,
      value: args.value !== undefined ? roundMoney(value) : undefined,
      contactId,
    });
    return {
      ok: true,
      summary: `Deal "${title}" created in stage "${deal.stage.name}".`,
      data: { deal_id: deal.id, stage: deal.stage.name, status: deal.status },
      subjectType: 'deal',
      subjectId: null,
    };
  }

  private async moveDealStage(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    const dealId = this.str(args.deal_id);
    const stageName = this.str(args.stage);
    if (!dealId || !stageName)
      return { ok: false, summary: 'A deal id and a target stage are required.', data: {} };
    const scope = this.scopeFor('record.deals.update');
    const deal = await this.deals.get(dealId, this.scopeFor('record.deals.read'));
    const stage = await this.resolveStage(deal.pipeline.id, stageName);
    if (!stage) return { ok: false, summary: `No stage matching "${stageName}".`, data: {} };
    const updated = await this.deals.moveStage(dealId, { stageId: stage.id }, scope);
    return {
      ok: true,
      summary: `Deal "${updated.title}" moved to "${updated.stage.name}" (status: ${updated.status}).`,
      data: { deal_id: updated.id, stage: updated.stage.name, status: updated.status },
      subjectType: 'deal',
      subjectId: null,
    };
  }

  // ---- companies ------------------------------------------------------------------------------------------------

  private async findCompany(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    const query = this.str(args.query);
    if (!query) return { ok: false, summary: 'Empty company query.', data: {} };
    const rows = await this.companies.selectData(
      { q: query, limit: 10 },
      this.scopeFor('record.companies.read'),
    );
    return {
      ok: true,
      summary: `${rows.length} company(ies) found for "${query}".`,
      data: { companies: rows },
    };
  }

  /**
   * The brief of the company whose name matches best, as the member's own: the facts, the key and the limits are the button's. The
   * answer carries the brief text for the model to relay; it holds no contact detail (the facts never did).
   */
  private async generateBrief(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    const name = this.str(args.name);
    if (!name) return { ok: false, summary: 'Tell me a company name for the brief.', data: {} };
    const scope = this.scopeFor('record.companies.read');
    const matches = await this.companies.selectData({ q: name, limit: 10 }, scope);
    const company = matches.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? matches[0];
    if (!company) return { ok: false, summary: `No company matches "${name}".`, data: {} };
    try {
      const { brief, cached } = await this.briefs.generate(company.id, scope, {
        regenerate: false,
      });
      return {
        ok: true,
        summary: `Brief of ${company.name} ready${cached ? ' (from the last one)' : ''}: ${brief.content.summary}`,
        data: { company: company.name, content: brief.content, stale: brief.stale },
        subjectType: 'company',
        subjectId: null,
      };
    } catch (err) {
      // A brief that cannot be written (no AI key, too soon, the provider down) is an answer to relay, not a crash of the turn.
      if (
        err instanceof AppError &&
        (err.code === ERROR_CODES.COMPANY_BRIEF_AI_UNAVAILABLE ||
          err.code === ERROR_CODES.COMPANY_BRIEF_RATE_LIMITED ||
          err.code === ERROR_CODES.COMPANY_BRIEF_PROVIDER_FAILED)
      ) {
        return { ok: false, summary: err.message, data: {} };
      }
      throw err;
    }
  }

  private async createCompany(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    this.scopeFor('record.companies.create');
    const name = this.str(args.name);
    if (!name) return { ok: false, summary: 'A company name is required.', data: {} };
    const company = await this.companies.create({
      name,
      industry: this.str(args.industry) || undefined,
    });
    return {
      ok: true,
      summary: `Company "${name}" created.`,
      data: { company_id: company.id },
      subjectType: 'company',
      subjectId: null,
    };
  }

  private async linkContactCompany(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    // Checked up front, before any side effect: resolveOrCreateByIdentity below can create a contact.
    this.scopeFor('record.contacts.create');
    const phone = this.str(args.contact_phone);
    const companyName = this.str(args.company_name);
    if (!phone || !companyName)
      return { ok: false, summary: 'A contact phone and a company name are required.', data: {} };
    const ctx = RequestContextStore.require();

    const resolved = await this.db.tx((tx) =>
      this.contacts.resolveOrCreateByIdentity(tx, ctx.orgId, { kind: 'phone', value: phone }),
    );
    if (resolved.outcome !== 'found' && resolved.outcome !== 'created') {
      return { ok: false, summary: 'Could not resolve that contact.', data: {} };
    }
    const contactUuid = (resolved as { uuid: string }).uuid;

    const matches = await this.companies.selectData(
      { q: companyName, limit: 5 },
      this.scopeFor('record.companies.read'),
    );
    const existing = matches.find((c) => c.name.toLowerCase() === companyName.toLowerCase());
    if (!existing) this.scopeFor('record.companies.create');
    const company = existing ?? (await this.companies.create({ name: companyName }));

    await this.companies.linkContacts(
      company.id,
      { contactIds: [contactUuid] },
      this.scopeFor('record.companies.update'),
    );
    return {
      ok: true,
      summary: `Linked contact to company "${companyName}".`,
      data: { company_id: company.id },
      subjectType: 'company',
      subjectId: null,
    };
  }

  // ---- reports ----------------------------------------------------------------------------------------------------

  private async salesReport(): Promise<AiCrmToolCallResult> {
    const scope = this.scopeFor('record.deals.read');
    // One list call covering every status (filtered client-side below) instead of three separate round trips —
    // the deal-list query has no date filter either, so "won this month" is also computed client-side.
    const [all, pipelines] = await Promise.all([
      this.deals.list({ limit: 200, order: 'desc' }, scope),
      this.pipelines.list(),
    ]);
    const probabilityByStage = new Map<string, number>();
    for (const p of pipelines)
      for (const s of p.stages) probabilityByStage.set(s.id, s.probability);

    const open = all.data.filter((d) => d.status === 'open');
    const won = all.data.filter((d) => d.status === 'won');
    const lost = all.data.filter((d) => d.status === 'lost');

    const openValue = sumMoney(open.map((d) => d.value));
    const weightedCents = open.reduce(
      (sum, d) =>
        sum +
        Math.round((Number(d.value) || 0) * 100) *
          ((probabilityByStage.get(d.stage.id) ?? 0) / 100),
      0,
    );

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const wonThisMonth = won.filter((d) => d.wonAt && new Date(d.wonAt) >= monthStart);
    const wonThisMonthValue = sumMoney(wonThisMonth.map((d) => d.value));

    const winRate =
      won.length + lost.length > 0
        ? Math.round((won.length / (won.length + lost.length)) * 100)
        : 0;

    return {
      ok: true,
      summary: 'Sales summary computed.',
      data: {
        open_deals: open.length,
        open_pipeline_value: openValue,
        weighted_forecast: Math.round(weightedCents) / 100,
        won_this_month: wonThisMonth.length,
        won_this_month_value: wonThisMonthValue,
        win_rate_pct: winRate,
      },
    };
  }

  private async createInvoice(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    this.scopeFor('record.invoices.create');
    const buyer = this.str(args.buyer_name);
    const items = Array.isArray(args.items) ? (args.items as Array<Record<string, unknown>>) : [];
    if (!buyer || items.length === 0)
      return { ok: false, summary: 'Need a buyer name and at least one line item.', data: {} };

    const invoice = await this.invoices.create({
      buyerName: buyer,
      buyerPhone: this.str(args.buyer_phone) || undefined,
      lines: items.map((row) => ({
        description: this.str(row.description) || 'Item',
        qty: String(this.num(row.qty) || 1),
        unitPrice: roundMoney(this.num(row.unit_price)),
      })),
    });
    return {
      ok: true,
      summary: `Created invoice ${invoice.number} for ${buyer}.`,
      data: { invoice_id: invoice.id, invoice_number: invoice.number },
      subjectType: 'invoice',
      subjectId: null,
    };
  }

  private async recordPayment(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    const amount = this.num(args.amount);
    const invoiceNumber = this.str(args.invoice_number);
    if (amount <= 0 || !invoiceNumber)
      return {
        ok: false,
        summary: 'An invoice number and a positive amount are required.',
        data: {},
      };

    const scope = this.scopeFor('record.invoices.read');
    const page = await this.invoices.list({ q: invoiceNumber, limit: 10, order: 'desc' }, scope);
    const invoice = page.data.find((i) => i.number === invoiceNumber) ?? page.data[0];
    if (!invoice)
      return { ok: false, summary: `No invoice matching "${invoiceNumber}".`, data: {} };

    const method = this.str(args.method).toLowerCase();
    const roundedAmount = roundMoney(amount);
    await this.payments.record(
      invoice.id,
      {
        amount: roundedAmount,
        method: oneOf(method, ['cash', 'bank', 'card', 'upi', 'cheque', 'other'] as const, 'bank'),
        allowOverpayment: false,
      },
      this.scopeFor('record.payments.create'),
    );
    return {
      ok: true,
      summary: `Recorded payment of ${roundedAmount} against ${invoice.number}.`,
      data: { invoice_number: invoice.number },
      subjectType: 'payment',
      subjectId: null,
    };
  }

  private async listOutstanding(): Promise<AiCrmToolCallResult> {
    const scope = this.scopeFor('record.payments.read');
    const result = await this.payments.outstanding({ limit: 10 }, scope);
    const total = sumMoney(result.data.map((r) => r.outstanding));
    return {
      ok: true,
      summary: `${result.data.length} contact(s) with an outstanding balance, total ${total.toFixed(2)}.`,
      data: { rows: result.data },
    };
  }

  private async revenueReport(): Promise<AiCrmToolCallResult> {
    const scope = this.scopeFor('record.payments.read');
    // `allTime.outstanding` already carries the real outstanding totals and invoice count — no need for a
    // separate `payments.outstanding()` call (which would force a full grouped aggregate just to read one flag).
    const [days30, allTime] = await Promise.all([
      this.payments.summary({ days: 30 }, scope),
      this.payments.summary({ days: 36_500 }, scope),
    ]);
    const collected30 = sumMoney(days30.collected.map((m) => m.amount));
    const collectedAll = sumMoney(allTime.collected.map((m) => m.amount));
    const outstandingTotal = sumMoney(allTime.outstanding.map((m) => m.amount));
    const outstandingInvoiceCount = allTime.outstanding.reduce((n, m) => n + m.invoices, 0);
    return {
      ok: true,
      summary: `Collected ${collected30.toFixed(2)} in 30 days; ${collectedAll.toFixed(2)} all-time. ${outstandingInvoiceCount} invoice(s) outstanding, ${outstandingTotal.toFixed(2)}.`,
      data: {
        collected_30d: collected30,
        collected_all: collectedAll,
        outstanding_total: outstandingTotal,
        outstanding_invoices: outstandingInvoiceCount,
      },
    };
  }

  // ---- tasks --------------------------------------------------------------------------------------------------

  private async memberUuidByName(name: string): Promise<string | undefined> {
    if (!name) return undefined;
    const page = await this.members.list({ q: name, limit: 5, order: 'desc' });
    return page.data[0]?.id;
  }

  private async createTask(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    this.scopeFor('record.tasks.create');
    const title = this.str(args.title);
    if (!title) return { ok: false, summary: 'Task needs a title.', data: {} };
    const assigneeId = await this.memberUuidByName(this.str(args.assignee_name));
    const dueRaw = this.str(args.due_at);
    // Known limitation: the workspace's own timezone isn't available in this toolkit, so a due date is always
    // 09:00 UTC, not 09:00 local — a task "due tomorrow" can land a few hours earlier/later than a user in a
    // non-UTC timezone meant, including possibly already-overdue for timezones east of UTC. Accepted for now
    // rather than threading workspace-settings timezone lookup through every tool call; revisit if it causes
    // real confusion.
    const dueAt = dueRaw ? `${dueRaw}T09:00:00+00:00` : undefined;
    const priority = this.str(args.priority).toLowerCase();

    const task = await this.tasks.create(
      {
        title,
        assigneeId,
        dueAt,
        priority: priority
          ? oneOf(priority, ['low', 'medium', 'high'] as const, 'medium')
          : undefined,
      },
      'ai',
    );
    return {
      ok: true,
      summary: `Created task "${title}"${dueAt ? ` due ${dueRaw}` : ''}.`,
      data: { task_id: task.id },
      subjectType: 'task',
      subjectId: null,
    };
  }

  private async assignTask(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    const taskId = this.str(args.task_id);
    const assigneeName = this.str(args.assignee_name);
    if (!taskId || !assigneeName)
      return { ok: false, summary: 'A task id and an assignee name are required.', data: {} };
    const scope = this.scopeFor('record.tasks.update');
    const task = await this.tasks.get(taskId, this.scopeFor('record.tasks.read'));
    const assigneeId = await this.memberUuidByName(assigneeName);
    if (!assigneeId)
      return { ok: false, summary: `No workspace member matches "${assigneeName}".`, data: {} };
    await this.tasks.update(taskId, { assigneeId, rowVersion: task.rowVersion }, scope);
    return {
      ok: true,
      summary: `Assigned task to ${assigneeName}.`,
      data: { task_id: taskId },
      subjectType: 'task',
      subjectId: null,
    };
  }

  private async completeTask(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    const taskId = this.str(args.task_id);
    if (!taskId) return { ok: false, summary: 'A task id is required.', data: {} };
    await this.tasks.complete(taskId, {}, this.scopeFor('record.tasks.update'));
    return {
      ok: true,
      summary: 'Marked the task done.',
      data: { task_id: taskId },
      subjectType: 'task',
      subjectId: null,
    };
  }

  private async listMyTasks(): Promise<AiCrmToolCallResult> {
    const page = await this.tasks.myTasks(
      { limit: 25, status: 'open' },
      this.scopeFor('record.tasks.read'),
    );
    const rows = page.data.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      due: t.dueAt,
      overdue: t.overdue,
    }));
    return { ok: true, summary: `${rows.length} open task(s).`, data: { tasks: rows } };
  }

  // ---- quotes (proposals / estimates) --------------------------------------------------------------------------

  private async createQuote(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    this.scopeFor('record.sales-docs.create');
    const docType = this.str(args.doc_type).toLowerCase() === 'estimate' ? 'estimate' : 'proposal';
    const items = Array.isArray(args.items) ? (args.items as Array<Record<string, unknown>>) : [];
    if (items.length === 0)
      return { ok: false, summary: 'A quote needs at least one line item.', data: {} };

    const doc = await this.salesDocs.create(
      {
        kind: docType,
        title: this.str(args.title) || undefined,
        buyerName: this.str(args.buyer_name) || undefined,
        buyerPhone: this.str(args.buyer_phone) || undefined,
        lines: items.map((row) => ({
          description: this.str(row.description) || 'Item',
          qty: String(this.num(row.qty) || 1),
          unitPrice: roundMoney(this.num(row.unit_price)),
        })),
      },
      'ai',
    );
    const link = await this.salesDocs.getLink(doc.id, this.scopeFor('record.sales-docs.read'));
    return {
      ok: true,
      summary: `Created ${doc.kind} ${doc.number}. Share link: ${link.url}`,
      data: { number: doc.number, url: link.url, total: doc.totals.total },
      subjectType: 'sales_doc',
      subjectId: null,
    };
  }

  private async listQuotes(): Promise<AiCrmToolCallResult> {
    const page = await this.salesDocs.list({ limit: 20 }, this.scopeFor('record.sales-docs.read'));
    const rows = page.data.map((d) => ({
      number: d.number,
      type: d.kind,
      status: d.status,
      total: d.totals.total,
    }));
    return { ok: true, summary: `${rows.length} quote(s).`, data: { quotes: rows } };
  }

  // ---- messaging ------------------------------------------------------------------------------------------------

  private async whatsappChannelId(): Promise<string | undefined> {
    const ctx = RequestContextStore.require();
    const channels = await this.db.tx((tx) => this.channels.list(tx, ctx.orgId));
    return channels.find((c) => c.kind.startsWith('whatsapp') && c.status === 'connected')?.uuid;
  }

  private async sendMessage(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    this.scopeFor('inbox.conversation.reply');
    const to = this.str(args.to);
    const text = this.str(args.message);
    if (!to || !text)
      return { ok: false, summary: 'Need both a recipient and a message.', data: {} };

    const channelId = await this.whatsappChannelId();
    if (!channelId)
      return { ok: false, summary: 'No connected WhatsApp number to send from.', data: {} };

    const ctx = RequestContextStore.require();
    const digits = to.replace(/\D+/g, '');
    let contactUuid: string | undefined;
    if (digits.length >= 6) {
      // Same reason as createDeal/linkContactCompany: this can mint a new contact.
      this.scopeFor('record.contacts.create');
      const resolved = await this.db.tx((tx) =>
        this.contacts.resolveOrCreateByIdentity(tx, ctx.orgId, { kind: 'phone', value: to }),
      );
      if (resolved.outcome === 'found' || resolved.outcome === 'created')
        contactUuid = (resolved as { uuid: string }).uuid;
    } else {
      const matches = await this.contacts.selectData(
        { q: to, limit: 1 },
        this.scopeFor('record.contacts.read'),
      );
      contactUuid = matches[0]?.id;
    }
    if (!contactUuid) return { ok: false, summary: `No contact matches "${to}".`, data: {} };

    const thread = await this.conversations.openConversationFor(contactUuid, channelId);
    await this.conversations.enqueueOutbound({
      conversationId: thread.id,
      clientMessageId: `aicrm-${thread.id}-${Date.now()}`,
      content: { kind: 'text', body: text },
    });
    return { ok: true, summary: `Message queued for sending.`, data: {} };
  }

  private async sendQuote(args: Record<string, unknown>): Promise<AiCrmToolCallResult> {
    this.scopeFor('record.sales-docs.send');
    this.scopeFor('inbox.conversation.reply');
    const number = this.str(args.number);
    if (!number) return { ok: false, summary: 'A quote number is required.', data: {} };
    const scope = this.scopeFor('record.sales-docs.read');
    const page = await this.salesDocs.list({ q: number, limit: 5 }, scope);
    const doc = page.data.find((d) => d.number === number) ?? page.data[0];
    if (!doc)
      return {
        ok: false,
        summary: `No matching proposal/estimate found for "${number}".`,
        data: {},
      };

    // Buyer phone isn't on the summary row; fetch the full record for it.
    const full = await this.salesDocs.get(doc.id, scope);
    const phone = this.str((full as { buyer?: { phone?: string | null } }).buyer?.phone);
    if (!phone)
      return {
        ok: false,
        summary: `${doc.kind} ${doc.number} has no buyer phone on file.`,
        data: {},
      };

    const channelId = await this.whatsappChannelId();
    if (!channelId)
      return { ok: false, summary: 'No connected WhatsApp number to send from.', data: {} };
    // Same reason as sendMessage: resolving the buyer by phone can mint a new contact.
    this.scopeFor('record.contacts.create');
    const ctx = RequestContextStore.require();
    const resolved = await this.db.tx((tx) =>
      this.contacts.resolveOrCreateByIdentity(tx, ctx.orgId, { kind: 'phone', value: phone }),
    );
    if (resolved.outcome !== 'found' && resolved.outcome !== 'created') {
      return { ok: false, summary: 'Could not resolve the buyer contact.', data: {} };
    }
    const link = await this.salesDocs.getLink(doc.id, scope);
    const body = `${doc.kind === 'estimate' ? 'Estimate' : 'Proposal'} ${doc.number}${doc.title ? ` — ${doc.title}` : ''}\nTotal: ${doc.totals.total}\nView & accept: ${link.url}`;

    const thread = await this.conversations.openConversationFor(
      (resolved as { uuid: string }).uuid,
      channelId,
    );
    await this.conversations.enqueueOutbound({
      conversationId: thread.id,
      clientMessageId: `aicrm-${thread.id}-${Date.now()}`,
      content: { kind: 'text', body },
    });
    return {
      ok: true,
      summary: `Sent ${doc.kind} ${doc.number}.`,
      data: { number: doc.number },
      subjectType: 'sales_doc',
      subjectId: null,
    };
  }
}

/**
 * `Number.prototype.toFixed` misrounds some values (`(1.005).toFixed(2) === '1.00'`) because the binary float
 * can't represent the decimal exactly — round to the nearest cent first, then format, which is the standard
 * workaround. The model's tool-call arguments arrive as JS numbers (JSON has no decimal type), so this is the
 * boundary where that imprecision is unavoidable; everywhere past it, amounts are decimal strings per contract.
 */
function roundMoney(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

/**
 * Sums decimal-string money amounts exactly, by summing cents as integers rather than accumulating JS floats —
 * the pattern every report tool here needs (deal values, collected totals, outstanding balances are all decimal
 * strings from their own contracts, not minor-unit integers the toolkit has access to).
 */
function sumMoney(values: readonly string[]): number {
  const cents = values.reduce((sum, v) => sum + Math.round((Number(v) || 0) * 100), 0);
  return cents / 100;
}

/** Narrows a free-text LLM argument to one of a contract's literal enum values, falling back when it doesn't match. */
function oneOf<T extends string>(value: string, options: readonly T[], fallback: T): T {
  return (options as readonly string[]).includes(value) ? (value as T) : fallback;
}
