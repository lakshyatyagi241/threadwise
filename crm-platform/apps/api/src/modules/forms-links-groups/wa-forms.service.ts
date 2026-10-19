import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  WFL_ERROR_CODES,
  type SaveWaFormInput,
  type WaForm,
  type WaFormList,
  type WaFormListQuery,
  type WaFormPickerList,
  type WaFormSubmissionList,
  type WaFormSubmissionListQuery,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { buildCsv } from '../../common/csv';
import { WabaApiError } from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import type { WabaConnection } from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import {
  buildMetaFlowJson,
  mapAudienceToMetaCategory,
} from '../../infra/providers/forms-links-groups/wa-form-flow-json';
import {
  WA_FORM_FLOWS,
  type WaFormFlowsPort,
} from '../../infra/providers/forms-links-groups/wa-form-flows.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { WABA_CONNECTIONS } from '../whatsapp-cloud-api-waba/waba-connections.port';
import type { WabaConnectionsPort } from '../whatsapp-cloud-api-waba/waba-connections.port';
import {
  fieldLabelsOf,
  flattenFormAnswer,
  toWaFormPickerItem,
  normalizeAudienceType,
  normalizeDefinition,
  toWaFormResponse,
  toWaFormSubmissionResponse,
} from './wa-forms.mapper';
import { WaFormsRepository } from './wa-forms.repository';

const MODULE_KEY = 'wa_forms';

/**
 * Deferred: Reference also registers a Flows encryption public key (`/{phone_id}/whatsapp_business_encryption`)
 * before every publish. Not ported yet — see docs/threadwise-port/inventory/forms-links-groups.md TW-WFL-004 port
 * notes; tracked, not silently dropped. Meta accepts a no-endpoint flow publish without it in practice; revisit if
 * a real Business Account publish is rejected for a missing key.
 */

/** Meta error 139000 / subcode 4233020 / body mentioning "Blocked by Integrity": an account-verification problem, not a form problem. */
function isAccountIntegrityBlock(err: WabaApiError): boolean {
  return (
    err.code === 139000 ||
    err.subcode === 4233020 ||
    (err.userMessage ?? err.message ?? '').toLowerCase().includes('blocked by integrity')
  );
}

@Injectable()
export class WaFormsService {
  private readonly logger = new Logger(WaFormsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WaFormsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(WABA_CONNECTIONS) private readonly connections: WabaConnectionsPort,
    @Inject(WA_FORM_FLOWS) private readonly flows: WaFormFlowsPort,
  ) {}

  async list(query: WaFormListQuery): Promise<WaFormList> {
    const ctx = RequestContextStore.require();
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    return this.db.tx(async (tx) => {
      const [rows, stats] = await Promise.all([
        this.repo.list(tx, ctx.orgId, query.limit, cursor),
        this.repo.stats(tx, ctx.orgId),
      ]);
      const { items, page } = buildPage(
        rows.map((r) => ({ ...r, createdAt: r.created_at, createdAtIso: r.created_at_iso })),
        query.limit,
      );
      return { items: items.map(toWaFormResponse), stats, page };
    });
  }

  async picker(): Promise<WaFormPickerList> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.pickable(tx, ctx.orgId);
      return { forms: rows.map(toWaFormPickerItem) };
    });
  }

  async get(uuid: string): Promise<WaForm> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Form', uuid);
      return toWaFormResponse(row);
    });
  }

  async create(input: SaveWaFormInput): Promise<WaForm> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const slug = await this.repo.freshSlug(tx, ctx.orgId, slugify(input.title));
      const created = await this.repo.insert(tx, ctx.orgId, ctx.userId ?? null, {
        title: input.title,
        purpose: input.purpose ?? null,
        slug,
        audienceType: input.audienceType,
        submissionCap: input.submissionCap,
        capReachedNote: input.capReachedNote ?? null,
        sendButtonLabel: input.sendButtonLabel,
        thankYouNote: input.thankYouNote ?? null,
        definitionJson: input.definition,
      });
      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'wa_form.created',
        payload: { uuid: created.uuid, title: created.title },
      });
      return toWaFormResponse(created);
    });
  }

  async update(uuid: string, input: SaveWaFormInput): Promise<WaForm> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!before) throw AppError.notFound('Form', uuid);
      const expectedVersion = input.rowVersion ?? before.row_version;
      const updated = await this.repo.update(tx, ctx.orgId, before.id, expectedVersion, {
        title: input.title,
        purpose: input.purpose ?? null,
        audienceType: input.audienceType,
        submissionCap: input.submissionCap,
        capReachedNote: input.capReachedNote ?? null,
        sendButtonLabel: input.sendButtonLabel,
        thankYouNote: input.thankYouNote ?? null,
        definitionJson: input.definition,
      });
      if (!updated) throw AppError.rowVersionConflict('Form');
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: before.id,
        action: 'update',
        delta: this.audit.diff(
          before as unknown as Record<string, unknown>,
          updated as unknown as Record<string, unknown>,
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: before.id,
        eventType: 'wa_form.updated',
        payload: { uuid: before.uuid },
      });
      return toWaFormResponse(updated);
    });
  }

  /** TW-WFL-004: resolve WABA creds, create-or-reuse the Meta Flow, upload the JSON, ensure the encryption key, publish. */
  async publish(uuid: string): Promise<WaForm> {
    const ctx = RequestContextStore.require();
    const { form, candidateConfigIds } = await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Form', uuid);
      const ids = await this.repo.wabaProviderConfigIds(tx, ctx.orgId);
      return { form: row, candidateConfigIds: ids };
    });

    // Flow management is a Meta-Graph-only API (apps/api/src/infra/providers/forms-links-groups/wa-form-flows.client.ts
    // refuses anything else), so only a direct Meta connection is "usable" here — an Interakt or registry-proxied
    // number would otherwise be accepted and its credentials sent to the wrong host.
    const isUsableMetaConnection = (
      conn: WabaConnection | null | undefined,
    ): conn is WabaConnection =>
      Boolean(
        conn && !conn.registry && conn.provider === 'meta' && conn.wabaId && conn.accessToken,
      );

    // On a retry/republish of an already-provisioned form, keep using the WABA connection that owns its existing
    // Meta Flow id — picking a different (e.g. newer) connection would call Flow-management with the wrong
    // account's credentials against a flow id that belongs to another WABA.
    const orderedConfigIds =
      form.meta_flow_id &&
      form.provider_config_id &&
      candidateConfigIds.includes(form.provider_config_id)
        ? [
            form.provider_config_id,
            ...candidateConfigIds.filter((id) => id !== form.provider_config_id),
          ]
        : candidateConfigIds;

    let resolved: { configId: number; conn: WabaConnection } | null = null;
    for (const configId of orderedConfigIds) {
      const r = await this.db.tx((tx) =>
        this.connections.resolveConnection(tx, ctx.orgId, { id: configId }),
      );
      if (isUsableMetaConnection(r?.conn)) {
        resolved = { configId, conn: r.conn };
        break;
      }
    }
    if (!resolved) {
      throw new AppError(
        WFL_ERROR_CODES.WFL_FORM_NO_WABA_CREDENTIALS,
        'No connected WhatsApp Cloud API number has usable credentials.',
        422,
      );
    }

    const flowJson = buildMetaFlowJson(
      normalizeDefinition(form.definition_json),
      form.send_button_label,
    );
    const category = mapAudienceToMetaCategory(normalizeAudienceType(form.audience_type));

    try {
      const { flowId } = await this.flows.ensureFlow(resolved.conn, form.meta_flow_id, {
        name: form.title,
        categories: [category],
      });
      if (flowId !== form.meta_flow_id) {
        // Save the newly-minted flow id now, before upload/publish can fail — otherwise a retry re-reads
        // meta_flow_id as still NULL and mints another orphaned Meta Flow object on every failed attempt.
        await this.db.tx((tx) =>
          this.repo.saveFlowId(tx, ctx.orgId, form.id, flowId, resolved!.configId),
        );
      }
      const { validationErrors } = await this.flows.uploadFlowJson(resolved.conn, flowId, flowJson);
      if (validationErrors.length > 0) {
        const first = validationErrors[0];
        throw new AppError(
          WFL_ERROR_CODES.WFL_FORM_META_VALIDATION_FAILED,
          first.line != null ? `${first.message} (line ${first.line})` : first.message,
          422,
        );
      }
      await this.flows.publish(resolved.conn, flowId);

      return this.db.tx(async (tx) => {
        await this.repo.markPublished(tx, ctx.orgId, form.id, flowId, resolved!.configId);
        await this.audit.record(tx, { module: MODULE_KEY, recordId: form.id, action: 'update' });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: form.id,
          eventType: 'wa_form.published',
          payload: { uuid: form.uuid, metaFlowId: flowId },
        });
        const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
        return toWaFormResponse(row!);
      });
    } catch (err) {
      const appError =
        err instanceof WabaApiError
          ? new AppError(
              isAccountIntegrityBlock(err)
                ? WFL_ERROR_CODES.WFL_FORM_ACCOUNT_VERIFICATION_REQUIRED
                : WFL_ERROR_CODES.WFL_FORM_PUBLISH_FAILED,
              err.userMessage ?? err.message,
              422,
            )
          : err instanceof AppError
            ? err
            : new AppError(WFL_ERROR_CODES.WFL_FORM_PUBLISH_FAILED, String(err), 422);
      await this.db.tx((tx) =>
        this.repo.markPublishFailed(tx, ctx.orgId, form.id, appError.message),
      );
      this.logger.warn(
        { orgId: ctx.orgId, formId: form.id, err: String(err) },
        'wa_form publish failed',
      );
      throw appError;
    }
  }

  async duplicate(uuid: string): Promise<WaForm> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const source = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!source) throw AppError.notFound('Form', uuid);
      const base = `${source.slug}-copy-${Math.random().toString(36).slice(2, 6)}`;
      const slug = await this.repo.freshSlug(tx, ctx.orgId, base);
      const copy = await this.repo.duplicate(tx, ctx.orgId, ctx.userId ?? null, source, slug);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: copy.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: copy.id,
        eventType: 'wa_form.created',
        payload: { uuid: copy.uuid, duplicatedFrom: source.uuid },
      });
      return toWaFormResponse(copy);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Form', uuid);
      await this.repo.delete(tx, ctx.orgId, row.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'wa_form.deleted',
        payload: { uuid: row.uuid },
      });
    });
  }

  async submissions(uuid: string, query: WaFormSubmissionListQuery): Promise<WaFormSubmissionList> {
    const ctx = RequestContextStore.require();
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    return this.db.tx(async (tx) => {
      const form = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!form) throw AppError.notFound('Form', uuid);
      const rows = await this.repo.submissionsList(tx, ctx.orgId, form.id, query.limit, cursor);
      const { items, page } = buildPage(
        rows.map((r) => ({ ...r, createdAt: r.created_at, createdAtIso: r.created_at_iso })),
        query.limit,
      );
      return {
        items: items.map(toWaFormSubmissionResponse),
        fieldLabels: fieldLabelsOf(form.definition_json),
        metaFlowId: form.meta_flow_id,
        page,
      };
    });
  }

  /** CSV export; `buildCsv` (shared with forms-builder) guards formula-injection cells and escapes quoting/line-ends. */
  async submissionsCsv(uuid: string): Promise<{ filename: string; csv: string }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const form = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!form) throw AppError.notFound('Form', uuid);
      const rows = await this.repo.submissionsForExport(tx, ctx.orgId, form.id);
      const labels = fieldLabelsOf(form.definition_json);
      const fieldIds = Object.keys(labels);
      const header = ['Submitted', 'Contact', 'Phone', ...fieldIds.map((id) => labels[id])];
      const body = rows.map((row) => {
        const answers = row.answers_json ?? {};
        return [
          row.submitted_at?.toISOString() ?? '',
          row.contact_name ?? '',
          row.contact_phone ?? '',
          // Same flattener the submissions list/API use, so a choice-field answer (e.g. `{id, title}`) renders
          // identically here instead of as "[object Object]".
          ...fieldIds.map((id) => flattenFormAnswer(answers[id])),
        ];
      });
      return { filename: `${form.slug}-submissions.csv`, csv: buildCsv(header, body) };
    });
  }
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'form';
}
