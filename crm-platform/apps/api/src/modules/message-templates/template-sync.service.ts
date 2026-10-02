import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type SyncTemplatesInput,
  type SyncTemplatesResult,
  type TemplateDetail,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  WABA_TEMPLATES,
  type RemoteTemplate,
  type WabaTemplatePort,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-template.port';
import type { WabaConnection } from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  localStatusFor,
  WabaConnectService,
  type ResolvedWabaConnection,
} from '../whatsapp-cloud-api-waba';
import { providerProblem } from './template-errors';
import {
  columnsOfState,
  mergeVariableMap,
  parseRemoteComponents,
  sameLanguage,
  statePatchFrom,
  type CurrentState,
  type ParsedComponents,
} from './template-remote';
import { toDetail } from './templates.mapper';
import { TemplatesRepository, type TemplatePatch, type TemplateRow } from './templates.repository';

/** Meta lists 100 a page; a WABA holds at most a few thousand, so this only stops a loop that never ends. */
const MAX_PAGES = 100;
/** A second refresh inside this window answers from the row (protects Meta's read quota, TW-TPL-026 rule 3). */
const REFRESH_COOLDOWN_MS = 15_000;
const MODULE = 'wa_templates';

const currentOf = (row: TemplateRow): CurrentState => ({
  status: row.status,
  metaCategory: row.metaCategory,
  qualityScore: row.qualityScore,
  approvedAt: row.approvedAt,
  pausedUntil: row.pausedUntil,
});

const attachmentColumn = (p: ParsedComponents) =>
  p.attachmentType === 'none' ? null : p.attachmentType;

/**
 * Keeping the local copy in step with Meta: one template (the refresh button, the stale sweep) or a whole account (the sync).
 * Every Meta call happens outside a database transaction; each write is one short transaction with its audit row and outbox event.
 */
@Injectable()
export class TemplateSyncService {
  private readonly logger = new Logger(TemplateSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TemplatesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly waba: WabaConnectService,
    @Inject(WABA_TEMPLATES) private readonly remote: WabaTemplatePort,
  ) {}

  // --- one template ------------------------------------------------------------------------------------------------

  /** Re-reads one template from Meta (TW-TPL-026). A template never sent to Meta, or checked a moment ago, comes back as it is. */
  async refresh(uuid: string): Promise<TemplateDetail> {
    const { orgId } = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid));
    if (!row) throw this.notFound();
    const fresh = await this.refreshRow(orgId, row, { cooldown: true, fail: true });
    return toDetail(fresh);
  }

  /** The sweeper's entry: one stale template by internal id. Returns whether its state changed. Never throws on a Meta failure. */
  async refreshStale(orgId: number, templateId: number): Promise<boolean> {
    const row = await this.db.tx((tx) => this.repo.findById(tx, orgId, templateId));
    if (!row) return false;
    const before = `${row.status}|${row.metaStatus}`;
    const after = await this.refreshRow(orgId, row, { cooldown: false, fail: false });
    return `${after.status}|${after.metaStatus}` !== before;
  }

  private async refreshRow(
    orgId: number,
    row: TemplateRow,
    opts: { cooldown: boolean; fail: boolean },
  ): Promise<TemplateRow> {
    if (!row.metaTemplateId || row.providerConfigId === null) return row;
    if (
      opts.cooldown &&
      row.lastSyncedAt &&
      Date.now() - row.lastSyncedAt.getTime() < REFRESH_COOLDOWN_MS
    )
      return row;

    const target = await this.db.tx((tx) =>
      this.waba.resolveConnection(tx, orgId, { id: row.providerConfigId! }),
    );
    if (!target?.conn) {
      if (opts.fail) throw this.noConnection();
      return this.bump(orgId, row);
    }

    let found: RemoteTemplate | null;
    try {
      found = await this.locate(target.conn, row);
    } catch (e) {
      // A failed read only moves the clock, so the sweep does not hammer a template Meta cannot answer for.
      const bumped = await this.bump(orgId, row);
      if (opts.fail) throw providerProblem('Could not read the template from Meta', e);
      this.logger.warn({ err: e, templateId: row.id }, '[TPL] stale refresh failed');
      return bumped;
    }
    if (!found) return this.bump(orgId, row);
    return this.writeState(orgId, row.id, found);
  }

  /** Meta keys a template by name + language; the id we stored wins when it is there. */
  private async locate(conn: WabaConnection, row: TemplateRow): Promise<RemoteTemplate | null> {
    const page = await this.remote.list(conn, { name: row.templateName, limit: 50 });
    return (
      page.items.find((t) => t.id === row.metaTemplateId) ??
      page.items.find(
        (t) =>
          t.name.toLowerCase() === row.templateName.toLowerCase() &&
          sameLanguage(t.language, row.language),
      ) ??
      null
    );
  }

  private async bump(orgId: number, row: TemplateRow): Promise<TemplateRow> {
    return this.db.tx(async (tx) => {
      const next = await this.repo.update(tx, orgId, row.id, { lastSyncedAt: new Date() });
      return next ?? row;
    });
  }

  private async writeState(
    orgId: number,
    id: number,
    remote: RemoteTemplate,
  ): Promise<TemplateRow> {
    return this.db.tx(async (tx) => {
      const row = (await this.repo.findById(tx, orgId, id))!;
      return this.applyState(tx, orgId, row, remote, new Date());
    });
  }

  /** Applies Meta's reading to a row and says so (audit + `template.status_changed`) when the state moved. */
  private async applyState(
    tx: Tx,
    orgId: number,
    row: TemplateRow,
    remote: RemoteTemplate,
    now: Date,
    extra: TemplatePatch = {},
  ): Promise<TemplateRow> {
    const state = statePatchFrom(remote, currentOf(row), now, localStatusFor);
    const patch: TemplatePatch = {
      ...columnsOfState(state),
      ...(row.metaTemplateId ? {} : { metaTemplateId: remote.id }),
      ...extra,
    };
    const next = (await this.repo.update(tx, orgId, row.id, patch)) ?? row;
    if (next.status !== row.status || next.metaStatus !== row.metaStatus) {
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'update',
        delta: this.audit.diff(
          { status: row.status, meta_status: row.metaStatus },
          { status: next.status, meta_status: next.metaStatus },
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: row.id,
        eventType: 'template.status_changed',
        payload: {
          templateId: row.uuid,
          from: { status: row.status, metaStatus: row.metaStatus },
          to: { status: next.status, metaStatus: next.metaStatus },
        },
      });
    }
    return next;
  }

  // --- a whole account ---------------------------------------------------------------------------------------------

  /**
   * Pulls every template of one number into the library (TW-TPL-028): creates what Meta has and we do not, updates what we know,
   * links a never-submitted local row to its Meta twin by name + language.
   *
   * A template Meta no longer lists is flagged `deleted`, never removed, and only when Meta's list was read to the end. If the
   * read broke off (an outage, the page cap) everything fetched so far is still saved, nothing is flagged, and the call then
   * fails with a retryable error so the caller knows the library is not yet complete (Geta deleted on a partial list).
   */
  async sync(input: SyncTemplatesInput): Promise<SyncTemplatesResult> {
    const { orgId, userId } = RequestContextStore.require();
    const target = await this.db.tx((tx) =>
      this.waba.resolveConnection(tx, orgId, { uuid: input.connectionId }),
    );
    if (!target) throw AppError.notFound('WhatsApp number', input.connectionId);
    if (!target.conn) throw this.noConnection();

    const { items, complete, failure } = await this.fetchAll(target.conn);
    if (!complete && items.length === 0 && failure)
      throw providerProblem('Could not read the templates from Meta', failure);

    const now = new Date();
    const result = await this.db.tx((tx) =>
      this.apply(tx, orgId, userId, target, items, complete, now),
    );
    if (!complete) {
      throw new AppError(
        ERROR_CODES.WABA_PROVIDER_UNAVAILABLE,
        `Saved ${items.length} template(s) from Meta, but its list could not be read to the end, so nothing was flagged as removed. Run the sync again.`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return result;
  }

  private async fetchAll(conn: WabaConnection): Promise<{
    items: RemoteTemplate[];
    complete: boolean;
    failure: unknown;
  }> {
    const items: RemoteTemplate[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      try {
        const res = await this.remote.list(conn, { after });
        items.push(...res.items);
        if (!res.next || res.next === after) return { items, complete: true, failure: null };
        after = res.next;
      } catch (failure) {
        return { items, complete: false, failure };
      }
    }
    return { items, complete: false, failure: null };
  }

  private async apply(
    tx: Tx,
    orgId: number,
    userId: number | null,
    target: ResolvedWabaConnection,
    remotes: RemoteTemplate[],
    complete: boolean,
    now: Date,
  ): Promise<SyncTemplatesResult> {
    const local = await this.repo.listForConnection(tx, orgId, target.id);
    const byMetaId = new Map<string, TemplateRow>();
    for (const r of local) if (r.metaTemplateId) byMetaId.set(r.metaTemplateId, r);
    const unlinked = local.filter((r) => !r.metaTemplateId);

    let created = 0;
    let updated = 0;
    const seen = new Set<string>();

    for (const remote of remotes) {
      if (!remote.id || seen.has(remote.id)) continue;
      seen.add(remote.id);
      const parsed = parseRemoteComponents(remote.components, remote.category);
      const known = byMetaId.get(remote.id) ?? this.takeUnlinked(unlinked, remote);

      if (known) {
        await this.applyState(tx, orgId, known, remote, now, {
          metaTemplateId: remote.id,
          header: parsed.header,
          templateBody: parsed.body || known.templateBody,
          footer: parsed.footer,
          buttons: parsed.buttons,
          codeExpirationMinutes: parsed.codeExpirationMinutes,
          templateType: parsed.templateType,
          attachmentType: attachmentColumn(parsed),
          ...(parsed.headerSampleUrl ? { headerSampleUrl: parsed.headerSampleUrl } : {}),
          parameterFormat: remote.parameterFormat ?? known.parameterFormat,
          variableMap: mergeVariableMap(
            parsed.variableMap,
            known.variableMap as Parameters<typeof mergeVariableMap>[1],
          ),
          submittedAt: known.submittedAt ?? now,
        });
        updated++;
        continue;
      }

      const state = statePatchFrom(
        remote,
        { status: 'pending', metaCategory: null, qualityScore: null, approvedAt: null, pausedUntil: null },
        now,
        localStatusFor,
      );
      const row = await this.repo.insertImported(tx, orgId, {
        userId,
        templateName: remote.name,
        language: remote.language,
        header: parsed.header,
        templateBody: parsed.body,
        footer: parsed.footer,
        codeExpirationMinutes: parsed.codeExpirationMinutes,
        buttons: parsed.buttons,
        variableMap: parsed.variableMap,
        category: (state.metaCategory ?? 'UTILITY').toLowerCase(),
        metaCategory: state.metaCategory,
        templateType: parsed.templateType,
        attachmentType: attachmentColumn(parsed),
        attachmentFile: null,
        headerSampleUrl: parsed.headerSampleUrl,
        parameterFormat: remote.parameterFormat ?? 'POSITIONAL',
        status: state.status ?? 'pending',
        metaStatus: state.metaStatus,
        metaTemplateId: remote.id,
        qualityScore: state.qualityScore,
        rejectionReasonCode: state.rejectionReasonCode,
        approvedAt: state.approvedAt ?? null,
        pausedUntil: state.pausedUntil ?? null,
        submittedAt: now,
        lastSyncedAt: now,
        providerConfigId: target.id,
      });
      // Its Meta id belongs to a row we cannot see (the same WABA connected in another workspace): not ours to take.
      if (row) created++;
      else this.logger.warn({ orgId, metaTemplateId: remote.id }, '[TPL] sync skipped a template owned elsewhere');
    }

    let missing = 0;
    if (complete) {
      for (const row of local) {
        if (!row.metaTemplateId || seen.has(row.metaTemplateId) || row.status === 'deleted') continue;
        await this.repo.update(tx, orgId, row.id, {
          metaStatus: 'DELETED',
          status: 'deleted',
          lastSyncedAt: now,
        });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE,
          aggregateId: row.id,
          eventType: 'template.status_changed',
          payload: {
            templateId: row.uuid,
            from: { status: row.status, metaStatus: row.metaStatus },
            to: { status: 'deleted', metaStatus: 'DELETED' },
          },
        });
        missing++;
      }
    }

    const result = { created, updated, missing, total: seen.size };
    await this.audit.record(tx, {
      module: 'wa_provider_configs',
      recordId: target.id,
      action: 'update',
      delta: { templates_synced: { old: null, new: { ...result, complete } } },
    });
    await this.outbox.emit(tx, {
      aggregateModule: MODULE,
      aggregateId: target.id,
      eventType: 'template.synced',
      payload: { connectionId: target.uuid, ...result, complete },
    });
    return result;
  }

  /** An unlinked row with the same name (any case) and language: exact first, then the base language (`en` ~ `en_US`). */
  private takeUnlinked(unlinked: TemplateRow[], remote: RemoteTemplate): TemplateRow | undefined {
    const name = remote.name.toLowerCase();
    const sameName = unlinked.filter((u) => u.templateName.toLowerCase() === name);
    const pick =
      sameName.find((u) => u.language === remote.language) ??
      sameName.find((u) => sameLanguage(u.language, remote.language));
    if (pick) unlinked.splice(unlinked.indexOf(pick), 1);
    return pick;
  }

  private notFound(): AppError {
    return new AppError(ERROR_CODES.TPL_NOT_FOUND, 'Template not found', HttpStatus.NOT_FOUND);
  }

  private noConnection(): AppError {
    return new AppError(
      ERROR_CODES.TPL_NO_CONNECTION,
      'This template has no connected WhatsApp number to reach Meta through. Reconnect the number first.',
      HttpStatus.CONFLICT,
    );
  }
}
