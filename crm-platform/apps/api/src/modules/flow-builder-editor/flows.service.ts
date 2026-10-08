import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  FLOW_EXPORT_MARKER,
  flbExtractTrigger,
  flbIsFlowType,
  flbNormalizeGraph,
  flbTriggerKeywordsTooLong,
  type FlowDetail,
  type FlowExport,
  type FlowGraph,
  type FlowSummary,
  type FlowTemplateCard,
  type FlowType,
  type FlowsOverview,
  type ImportFlowRequest,
  type ListFlowsQuery,
  type ListFlowsResponse,
  type SaveFlowRequest,
  type SetBuilderModeRequest,
  type ToggleFlowResponse,
  type UpdateFlowRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { BrandingService, SettingsService } from '../platform-settings-branding-storage';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { GetaPublishSyncService } from './geta-publish/geta-publish-sync.service';
import { encodeFlowCursor, nameWithSuffix, parseImportPayload, stateOf } from './flow-rules';
import { flowEventPayload, toFeatured, toFlowDetail, toFlowSummary } from './flows.mapper';
import {
  FlowsRepository,
  type FlowRow,
  type FlowUpdate,
  type NewFlow,
  type RefTable,
} from './flows.repository';

export const FLOW_MODULE = 'flows';

/** Which table holds the sender a Trigger's `deviceId` (`<engine>:<uuid>`) points at. */
const ENGINE_TABLE: Record<string, RefTable> = {
  baileys: 'devices',
  waba: 'wa_provider_configs',
  twilio: 'wa_provider_configs',
  instagram: 'workspace_ig_accounts',
  facebook: 'facebook_pages',
  tiktok: 'tiktok_accounts',
  telegram: 'telegram_bots',
  line: 'line_channels',
  wechat: 'wechat_channels',
  viber: 'viber_channels',
  email: 'workspace_email_accounts',
};

interface TriggerColumns {
  triggerKind: string;
  triggerValue: number | null;
  triggerKeywords: string | null;
  triggerDeviceId: number | null;
  triggerChannelId: number | null;
  provider: string | null;
}

/** Flow types whose inbound path reads `flows` directly in WaDesk: no keyword rule, so no keyword length limit. */
const KEYWORD_LENGTH_EXEMPT: ReadonlySet<string> = new Set([
  'instagram',
  'facebook',
  'tiktok',
  'telegram',
  'email',
]);

type Raw = Record<string, unknown>;

/**
 * Flows (WD-FLB-001..022, 029). One transaction per operation: the row lock, the write, the trigger columns, the audit
 * row and the outbox event commit together or not at all.
 *
 * What differs from WaDesk (written down in docs/wadesk-port/parity/flow-builder-editor.md): a save carries the row
 * version (two admins no longer overwrite each other silently); the trigger columns are derived inside the save
 * transaction, so a keyword that is too long is refused BEFORE the row changes; duplicate checks the plan cap; publish
 * publishes the row that was just saved (WaDesk created a second flow); deleting a flow removes its subscribers with it.
 */
@Injectable()
export class FlowsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FlowsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly plans: PlanEntitlementService,
    private readonly branding: BrandingService,
    private readonly geta: GetaPublishSyncService,
    private readonly settings: SettingsService,
  ) {}

  // --- reads ---------------------------------------------------------------------------------------------------------

  async list(query: ListFlowsQuery): Promise<ListFlowsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const filter = { status: query.status, category: query.category, q: query.q };
      const rows = await this.repo.list(tx, ctx.orgId, filter, {
        cursor: query.cursor,
        limit: query.limit,
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map(toFlowSummary),
        page: {
          nextCursor: hasMore && last ? encodeFlowCursor(last.updatedAtIso, last.id) : null,
          hasMore,
          limit: query.limit,
        },
        ...(query.includeTotal ? { total: await this.repo.count(tx, ctx.orgId, filter) } : {}),
      };
    });
  }

  async overview(): Promise<FlowsOverview> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const [statusCounts, categoryCounts, featured, templates] = await Promise.all([
        this.repo.statusCounts(tx, ctx.orgId),
        this.repo.categoryCounts(tx, ctx.orgId),
        this.repo.featured(tx, ctx.orgId),
        this.templateCards(tx),
      ]);
      const platformBuilderMode = (await this.settings.values('flowBuilder')).mode;
      const workspaceBuilderMode = await this.workspaceBuilderMode(tx, ctx.orgId);
      return {
        statusCounts,
        categoryCounts,
        featured: featured ? toFeatured(featured) : null,
        templates,
        builderMode: workspaceBuilderMode ?? platformBuilderMode,
        platformBuilderMode,
        workspaceBuilderMode,
      };
    });
  }

  /** The workspace's own builder choice; null when it follows the platform default (or never saved its settings). */
  private async workspaceBuilderMode(tx: Tx, orgId: number): Promise<'simple' | 'advanced' | null> {
    const res = await tx.execute(
      sql`SELECT flow_builder_mode FROM workspace_settings WHERE org_id = ${orgId}`,
    );
    const mode = (res.rows[0] as { flow_builder_mode: string | null } | undefined)
      ?.flow_builder_mode;
    return mode === 'simple' || mode === 'advanced' ? mode : null;
  }

  /** Flows > Builder: a workspace picks Simple or Advanced, or `inherit` to follow the platform default again. */
  async setBuilderMode(input: SetBuilderModeRequest): Promise<FlowsOverview> {
    const ctx = RequestContextStore.require();
    const next = input.mode === 'inherit' ? null : input.mode;
    await this.db.tx(async (tx) => {
      const before = await this.workspaceBuilderMode(tx, ctx.orgId);
      if (before === next) return;
      // A workspace that never saved its settings has no row yet; every other column has a default.
      const res = await tx.execute(sql`
        INSERT INTO workspace_settings (org_id, flow_builder_mode) VALUES (${ctx.orgId}, ${next})
        ON CONFLICT (org_id) DO UPDATE SET flow_builder_mode = EXCLUDED.flow_builder_mode
        RETURNING id
      `);
      const recordId = Number((res.rows[0] as { id: number | string }).id);
      await this.audit.record(tx, {
        module: 'flow_builder_settings',
        recordId,
        action: 'update',
        delta: { builderMode: { old: before, new: next } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'flow_builder_settings',
        aggregateId: recordId,
        eventType: 'flow_builder_settings.updated',
        payload: { builderMode: next },
      });
    });
    return this.overview();
  }

  async get(uuid: string): Promise<FlowDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.require(tx, ctx.orgId, uuid);
      return { ...toFlowDetail(row), getaSync: await this.geta.status(tx, ctx.orgId, row) };
    });
  }

  /** The export file (WD-FLB-008): the graph verbatim under WaDesk's wrapper marker, no workspace or user ids. */
  async export(uuid: string): Promise<{ file: FlowExport; name: string }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.require(tx, ctx.orgId, uuid);
      const file: FlowExport = {
        [FLOW_EXPORT_MARKER]: 1,
        exported_at: new Date().toISOString(),
        name: row.name,
        flow_type: (flbIsFlowType(row.flowType) ? row.flowType : 'chat') as FlowType,
        category: row.category,
        flow_data: row.graph ?? { flowNodes: [], flowEdges: [], vars: [] },
      } as FlowExport;
      return { file, name: row.name };
    });
  }

  // --- writes --------------------------------------------------------------------------------------------------------

  /** Save of a new flow (WD-FLB-019): the plan's flow cap applies to creation only. */
  async create(input: SaveFlowRequest): Promise<FlowDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      await this.assertRoom(tx, ctx.orgId);
      const graph = flbNormalizeGraph(input.graph);
      const id = await this.insertFlow(tx, ctx.orgId, ctx.userId, {
        name: input.name,
        graph,
        category: input.category?.trim() || null,
        flowType: input.flowType ?? 'chat',
      });
      return this.afterInsert(tx, ctx.orgId, id, 'flow.created');
    });
  }

  /** Save of an existing flow: rewrites the whole graph, re-derives the trigger columns, never re-checks the cap. */
  async save(uuid: string, input: UpdateFlowRequest): Promise<FlowDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lock(tx, ctx.orgId, uuid);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Flow');
      const graph = flbNormalizeGraph(input.graph);
      const flowType = input.flowType ?? (row.flowType as FlowType) ?? 'chat';
      const update: FlowUpdate = {
        name: input.name,
        graph,
        category: input.category?.trim() || null,
        flowType,
        ...(await this.triggerColumns(tx, ctx.orgId, graph, flowType)),
      };
      const ok = await this.repo.update(tx, ctx.orgId, row.id, input.rowVersion, update);
      if (!ok) throw AppError.rowVersionConflict('Flow');
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.audit.record(tx, {
        module: FLOW_MODULE,
        recordId: row.id,
        action: 'update',
        delta: this.audit.diff(
          { name: row.name, category: row.category, flowType: row.flowType, nodes: row.nodeCount },
          {
            name: after.name,
            category: after.category,
            flowType: after.flowType,
            nodes: after.nodeCount,
          },
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: FLOW_MODULE,
        aggregateId: row.id,
        eventType: 'flow.saved',
        payload: flowEventPayload(after),
      });
      return toFlowDetail(after);
    });
  }

  async rename(uuid: string, name: string): Promise<FlowDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lock(tx, ctx.orgId, uuid);
      if (row.name === name) return toFlowDetail(row);
      await this.repo.rename(tx, ctx.orgId, row.id, name);
      await this.audit.record(tx, {
        module: FLOW_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { name: { old: row.name, new: name } },
      });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.outbox.emit(tx, {
        aggregateModule: FLOW_MODULE,
        aggregateId: row.id,
        eventType: 'flow.renamed',
        payload: flowEventPayload(after),
      });
      return toFlowDetail(after);
    });
  }

  /** Pause / resume (WD-FLB-004): flips `is_active`. A draft can be flipped too; its pill still says Draft (WaDesk quirk kept). */
  async toggle(uuid: string): Promise<ToggleFlowResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lock(tx, ctx.orgId, uuid);
      const next = !row.isActive;
      await this.repo.setActive(tx, ctx.orgId, row.id, next);
      await this.audit.record(tx, {
        module: FLOW_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { isActive: { old: row.isActive, new: next } },
      });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.outbox.emit(tx, {
        aggregateModule: FLOW_MODULE,
        aggregateId: row.id,
        eventType: next ? 'flow.resumed' : 'flow.paused',
        payload: flowEventPayload(after),
      });
      return { isActive: next, state: stateOf(after.isPublished, after.isActive) };
    });
  }

  /** Copy as a new unpublished draft "<name> (Copy)" (WD-FLB-006). The plan cap applies (WaDesk skipped it: documented deviation). */
  async duplicate(uuid: string): Promise<FlowDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const src = await this.require(tx, ctx.orgId, uuid);
      await this.assertRoom(tx, ctx.orgId);
      const graph = src.graph ?? { flowNodes: [], flowEdges: [], vars: [] };
      const id = await this.insertFlow(tx, ctx.orgId, ctx.userId, {
        name: nameWithSuffix(src.name, ' (Copy)'),
        graph,
        category: src.category,
        flowType: src.flowType as FlowType,
        isActive: src.isActive,
      });
      return this.afterInsert(tx, ctx.orgId, id, 'flow.duplicated');
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.lock(tx, ctx.orgId, uuid);
      await this.repo.deleteById(tx, ctx.orgId, row.id);
      await this.audit.record(tx, { module: FLOW_MODULE, recordId: row.id, action: 'delete' });
      // The runtime (FLR) stops sessions of this flow when it sees the event.
      await this.outbox.emit(tx, {
        aggregateModule: FLOW_MODULE,
        aggregateId: row.id,
        eventType: 'flow.deleted',
        payload: flowEventPayload(row),
      });
    });
  }

  async publish(uuid: string): Promise<FlowDetail> {
    return this.setPublished(uuid, true);
  }

  async unpublish(uuid: string): Promise<FlowDetail> {
    return this.setPublished(uuid, false);
  }

  /** Import (WD-FLB-009): an export file or a bare graph becomes a new unpublished flow "<name> (imported)". */
  async importFlow(input: ImportFlowRequest): Promise<FlowDetail> {
    const ctx = RequestContextStore.require();
    // Parse first: an invalid file must not be told "plan limit reached".
    const parsed = parseImportPayload(input.payload, {
      suffix: ' (imported)',
      brand: await this.branding.name(),
    });
    return this.db.tx(async (tx) => {
      await this.assertRoom(tx, ctx.orgId);
      const id = await this.insertFlow(tx, ctx.orgId, ctx.userId, {
        name: parsed.name,
        graph: parsed.graph,
        category: parsed.category,
        flowType: parsed.flowType,
      });
      return this.afterInsert(tx, ctx.orgId, id, 'flow.imported');
    });
  }

  // --- templates (tenant side) ---------------------------------------------------------------------------------------

  async templates(): Promise<FlowTemplateCard[]> {
    return this.db.tx((tx) => this.templateCards(tx));
  }

  /** Clone an active template into a fresh unpublished draft named exactly like the template (WD-FLB-010). */
  async cloneTemplate(templateUuid: string): Promise<FlowDetail> {
    const ctx = RequestContextStore.require();
    let templateId = 0;
    const detail = await this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT id, name, flow_type, category, flow_data FROM flow_templates WHERE uuid = ${templateUuid} AND is_active`,
      );
      const t = res.rows[0] as Raw | undefined;
      if (!t) throw AppError.notFound('Template', templateUuid);
      templateId = Number(t.id);
      await this.assertRoom(tx, ctx.orgId);
      const id = await this.insertFlow(tx, ctx.orgId, ctx.userId, {
        name: String(t.name).slice(0, 255),
        graph: flbNormalizeGraph(t.flow_data),
        category: t.category ? String(t.category).slice(0, 64) : null,
        flowType: flbIsFlowType(t.flow_type) ? t.flow_type : 'chat',
      });
      return this.afterInsert(tx, ctx.orgId, id, 'flow.cloned', { templateId: templateUuid });
    });
    // flow_templates is platform data (writes need the privileged role): the counter moves after the clone committed.
    await this.db.privileged(async (tx) => {
      await tx.execute(
        sql`UPDATE flow_templates SET clone_count = clone_count + 1 WHERE id = ${templateId}`,
      );
    });
    return detail;
  }

  // --- internals -----------------------------------------------------------------------------------------------------

  private async templateCards(tx: Tx): Promise<FlowTemplateCard[]> {
    const res = await tx.execute(sql`
      SELECT uuid, name, description, flow_type, category,
        coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(flow_data->'flowNodes') = 'array' THEN flow_data->'flowNodes' END), 0) AS steps
      FROM flow_templates WHERE is_active ORDER BY sort_order ASC, id DESC
    `);
    return (res.rows as Raw[]).map((r) => ({
      id: r.uuid as string,
      name: r.name as string,
      description: (r.description as string | null) ?? null,
      flowType: (flbIsFlowType(r.flow_type) ? r.flow_type : 'chat') as FlowType,
      category: (r.category as string | null) ?? null,
      steps: Number(r.steps),
    }));
  }

  private async setPublished(uuid: string, published: boolean): Promise<FlowDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lock(tx, ctx.orgId, uuid);
      await this.repo.setPublished(tx, ctx.orgId, row.id, published);
      await this.audit.record(tx, {
        module: FLOW_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { isPublished: { old: row.isPublished, new: published } },
      });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.outbox.emit(tx, {
        aggregateModule: FLOW_MODULE,
        aggregateId: row.id,
        eventType: published ? 'flow.published' : 'flow.unpublished',
        payload: flowEventPayload(after),
      });
      // Geta publishing (beyond WaDesk): only a sync row and an outbox event here; the worker makes the remote calls, so a
      // console that is down never fails or slows this publish.
      if (published) await this.geta.onPublished(tx, ctx.orgId, after);
      return { ...toFlowDetail(after), getaSync: await this.geta.status(tx, ctx.orgId, after) };
    });
  }

  private async require(tx: Tx, orgId: number, uuid: string): Promise<FlowRow> {
    const row = await this.repo.findByUuid(tx, orgId, uuid);
    if (!row) throw AppError.notFound('Flow', uuid);
    return row;
  }

  private async lock(tx: Tx, orgId: number, uuid: string): Promise<FlowRow> {
    const row = await this.repo.findByUuid(tx, orgId, uuid, true);
    if (!row) throw AppError.notFound('Flow', uuid);
    return row;
  }

  /** 422 PLAN_LIMIT_REACHED when one more flow would pass the plan's cap (0 = unlimited). A live count, so a delete frees a slot. */
  private async assertRoom(tx: Tx, orgId: number): Promise<void> {
    await this.plans.assertWithinLimit(orgId, 'flows', await this.repo.countAll(tx, orgId));
  }

  private async insertFlow(
    tx: Tx,
    orgId: number,
    userId: number | null,
    f: {
      name: string;
      graph: FlowGraph;
      category: string | null;
      flowType: FlowType;
      isActive?: boolean;
    },
  ): Promise<number> {
    const t = await this.triggerColumns(tx, orgId, f.graph, f.flowType);
    const nf: NewFlow = {
      userId,
      name: f.name,
      graph: f.graph,
      category: f.category,
      flowType: f.flowType,
      isActive: f.isActive,
      ...t,
    };
    return this.repo.insert(tx, orgId, nf);
  }

  private async afterInsert(
    tx: Tx,
    orgId: number,
    id: number,
    eventType: string,
    extra: Record<string, unknown> = {},
  ): Promise<FlowDetail> {
    const row = (await this.repo.findById(tx, orgId, id))!;
    await this.audit.record(tx, { module: FLOW_MODULE, recordId: id, action: 'insert' });
    await this.outbox.emit(tx, {
      aggregateModule: FLOW_MODULE,
      aggregateId: id,
      eventType,
      payload: { ...flowEventPayload(row), ...extra },
    });
    return toFlowDetail(row);
  }

  /**
   * The Trigger node read into the plain columns the inbound matcher and enrolment query (WD-FLB-020). A tag, group, stage
   * or sender arrives as a uuid and is resolved here, inside the transaction; one that does not resolve stores null, as
   * WaDesk stored null for a non-numeric id. A keyword text over 255 characters is refused with the same message WaDesk
   * showed, and nothing has been written yet (WaDesk wrote first and threw after).
   */
  private async triggerColumns(
    tx: Tx,
    orgId: number,
    graph: FlowGraph,
    flowType: string,
  ): Promise<TriggerColumns> {
    const t = flbExtractTrigger(graph);
    // WaDesk raised this only from the keyword-rule sync: keyword triggers on a WhatsApp-style flow (it skipped Instagram,
    // Facebook, TikTok, Telegram and Email flows, which read `flows` directly, and every non-keyword trigger).
    const tooLong =
      t.kind === 'keyword' && !KEYWORD_LENGTH_EXEMPT.has(flowType)
        ? flbTriggerKeywordsTooLong(t.keywords)
        : null;
    if (tooLong) {
      throw new AppError(
        ERROR_CODES.FLB_TRIGGER_KEYWORDS_TOO_LONG,
        tooLong,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'graph', message: tooLong }],
      );
    }
    let triggerValue: number | null = null;
    if (t.valueKind === 'zero') triggerValue = 0;
    else if (t.valueRef) {
      const table: RefTable | null =
        t.valueKind === 'tag'
          ? 'tags'
          : t.valueKind === 'group'
            ? 'contact_groups'
            : t.valueKind === 'stage'
              ? 'pipeline_stages'
              : null;
      triggerValue = table ? await this.repo.resolveRef(tx, orgId, table, t.valueRef) : null;
    }
    let triggerDeviceId: number | null = null;
    let triggerChannelId: number | null = null;
    if (t.engine && t.senderRef) {
      triggerDeviceId = await this.repo.resolveRef(tx, orgId, ENGINE_TABLE[t.engine]!, t.senderRef);
      // What the runtime reads: the inbox channel of that sender. A sender with no channel row yet leaves it null, and the
      // runtime then matches by the `provider` stamp (every connected channel of that engine), as for a flow with no sender.
      triggerChannelId = await this.repo.resolveChannel(tx, orgId, t.engine, t.senderRef);
    }
    return {
      triggerKind: t.kind,
      triggerValue,
      triggerKeywords: t.keywords,
      triggerDeviceId,
      triggerChannelId,
      provider: t.engine,
    };
  }
}

export type { FlowSummary };
