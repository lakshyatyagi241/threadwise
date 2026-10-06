import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  listDealsQuerySchema,
  v1UpdateDealSchema,
  type PipelineResponse,
  type V1CreateDeal,
  type V1Deal,
  type V1UpdateDeal,
} from '@crm/contracts';
import { RequestContextStore } from '../../../../../common/context/request-context';
import { AppError } from '../../../../../common/errors/app-error';
import { ZodValidationPipe } from '../../../../../common/pipes/zod-validation.pipe';
import { DatabaseService } from '../../../../../infra/db/database.service';
import { AuditService } from '../../../../../kernel/audit/audit.service';
import { ContactsRepository, DealsService, PipelinesService } from '../../../../crm';
import { has, isUuid, uuidOrNotFound } from '../v1-ids';
import { toV1Deal } from './deals.mapper';

const UPDATE_ATTEMPTS = 2;
const STATUSES = new Set(['open', 'won', 'lost']);

const invalid = (path: string, message: string) =>
  AppError.validation('The given data was invalid.', [{ path, message }]);

/** Reference's 422 `unprocessable`: a request that is well formed but cannot be applied (the renderer words the code). */
const unprocessable = (code: keyof typeof ERROR_CODES, message: string) =>
  new AppError(ERROR_CODES[code], message, HttpStatus.UNPROCESSABLE_ENTITY);

/** The dashboard service's camelCase `details` paths, as the field names of Reference's request. */
const WIRE_FIELD: Record<string, string> = {
  ownerId: 'owner_user_id',
  stageId: 'stage_id',
  pipelineId: 'pipeline_id',
  contactId: 'contact_id',
  expectedCloseDate: 'expected_close_date',
  lostReasonId: 'lost_reason',
  lostReason: 'lost_reason',
  value: 'value',
  currency: 'currency',
  title: 'title',
};

/**
 * Failures of the delegated service as Reference's request would word them: `details` keys are the public field names, and an owner or
 * amount the service refuses is a plain validation failure of that field (Reference validated both on the request). The stage codes are
 * rendered `unprocessable` by the v1 error renderer.
 */
export function toV1DealError(err: unknown): unknown {
  if (!(err instanceof AppError)) return err;
  const details = err.details?.map((e) => ({
    path: WIRE_FIELD[e.path] ?? e.path,
    message: e.message,
  }));
  if (err.code === ERROR_CODES.DEAL_OWNER_INVALID)
    return invalid('owner_user_id', 'The selected owner_user_id is invalid.');
  if (err.code === ERROR_CODES.DEAL_VALUE_INVALID)
    return invalid('value', 'The value is not a valid amount for the currency.');
  if (err.code === ERROR_CODES.VALIDATION_FAILED && details)
    return AppError.validation(err.message, details);
  if (
    (err.code === ERROR_CODES.DEAL_STAGE_MISMATCH || err.code === ERROR_CODES.DEAL_NO_OPEN_STAGE) &&
    details
  )
    return new AppError(err.code, err.message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  return err;
}

/** `2026-03-01`, `2026-03-01T10:00:00Z`, `1 March 2026`: anything parseable, kept as the calendar day (UTC). */
function toDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** A falsy reference (null, "", 0) means "none" in Reference's lenient resolution. */
const falsyRef = (v: string | null | undefined): boolean => v == null || v === '' || v === '0';

/**
 * Deals of the customer API (TW-API-048 to 054). `DealsService` does the work, including the stage engine (status and won/lost stamps
 * follow the stage, a timeline row, `deal.stage_changed` for the flows, owner events). What Reference's API does on top is kept here:
 *   - create resolves an unknown pipeline, stage or contact leniently (default pipeline, its first stage, no contact);
 *   - update is strict about the stage (it must belong to the deal's pipeline) but lenient about the contact (unknown unlinks it);
 *   - `lost_reason` can be written on its own (on a lost deal; the status stamps forbid it elsewhere), which the service has no field for.
 */
@Injectable()
export class V1DealsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly deals: DealsService,
    private readonly pipelines: PipelinesService,
    private readonly contacts: ContactsRepository,
    private readonly audit: AuditService,
  ) {}

  async list(
    paging: { limit: number; cursor?: string },
    filter: { pipeline_id?: string; stage_id?: string; status?: string },
  ) {
    const empty = {
      data: [] as V1Deal[],
      page: { nextCursor: null, hasMore: false, limit: paging.limit },
    };
    // Reference does not validate these: a value that matches nothing is an empty list, not an error.
    if (filter.status && !STATUSES.has(filter.status)) return empty;
    if (
      (filter.pipeline_id && !isUuid(filter.pipeline_id)) ||
      (filter.stage_id && !isUuid(filter.stage_id))
    )
      return empty;
    const query = listDealsQuerySchema.parse({
      limit: paging.limit,
      cursor: paging.cursor,
      pipelineId: filter.pipeline_id || undefined,
      stageId: filter.stage_id || undefined,
      status: filter.status || undefined,
    });
    const res = await this.deals.list(query, 'all');
    return { data: res.data.map(toV1Deal), page: res.page };
  }

  async show(id: string): Promise<V1Deal> {
    return toV1Deal(await this.deals.get(uuidOrNotFound(id, 'Deal'), 'all'));
  }

  async create(body: V1CreateDeal): Promise<V1Deal> {
    try {
      return await this.createDeal(body);
    } catch (err) {
      throw toV1DealError(err);
    }
  }

  async update(id: string, raw: unknown): Promise<V1Deal> {
    try {
      return await this.updateDeal(id, raw);
    } catch (err) {
      throw toV1DealError(err);
    }
  }

  private async createDeal(body: V1CreateDeal): Promise<V1Deal> {
    const ctx = RequestContextStore.require();
    // `list` seeds the default pipeline for a workspace that has none, as Reference did on its first deal.
    const all = await this.pipelines.list();
    const pipeline =
      (isUuid(body.pipeline_id)
        ? all.find((p) => p.id === body.pipeline_id!.toLowerCase())
        : undefined) ??
      all.find((p) => p.isDefault) ??
      all[0];
    if (!pipeline) throw unprocessable('DEAL_NO_OPEN_STAGE', 'Pipeline has no stages.');
    const stage = isUuid(body.stage_id)
      ? pipeline.stages.find((s) => s.id === body.stage_id!.toLowerCase())
      : undefined;
    if (!stage && pipeline.stages.length === 0)
      throw unprocessable('DEAL_NO_OPEN_STAGE', 'Pipeline has no stages.');

    const contactId = await this.existingContact(ctx.orgId, body.contact_id);
    const currency = this.currencyOf(body.currency);
    const created = await this.deals.create(
      {
        title: body.title,
        pipelineId: pipeline.id,
        ...(stage ? { stageId: stage.id } : {}),
        value: body.value ?? undefined,
        currency,
        // Reference stores the owner as sent and none when omitted; the service would default an omitted owner to the key's member.
        ownerId: this.ownerRef(body.owner_user_id),
        ...(contactId ? { contactId } : {}),
        expectedCloseDate: body.expected_close_date ? toDate(body.expected_close_date) : undefined,
      },
      'api',
    );
    return toV1Deal(created);
  }

  private async updateDeal(id: string, raw: unknown): Promise<V1Deal> {
    const uuid = uuidOrNotFound(id, 'Deal');
    const ctx = RequestContextStore.require();
    // Lookup first, validation second: an unknown id with a bad body is a 404 (TW-API-051 rule 1).
    await this.deals.get(uuid, 'all');
    const body: V1UpdateDeal = new ZodValidationPipe(v1UpdateDealSchema).transform(raw ?? {});

    for (let attempt = 1; ; attempt += 1) {
      const deal = await this.deals.get(uuid, 'all');
      const patch: Parameters<DealsService['update']>[1] = { rowVersion: deal.rowVersion };

      if (has(raw, 'title') && body.title !== undefined) patch.title = body.title;
      if (has(raw, 'expected_close_date'))
        patch.expectedCloseDate = body.expected_close_date
          ? toDate(body.expected_close_date)
          : null;
      if (has(raw, 'owner_user_id'))
        patch.ownerId = falsyRef(body.owner_user_id)
          ? null
          : (this.ownerRef(body.owner_user_id) ?? null);
      if (has(raw, 'contact_id')) {
        patch.contactId = falsyRef(body.contact_id)
          ? null
          : ((await this.existingContact(ctx.orgId, body.contact_id)) ?? null);
      }

      // The amount and its currency travel together in the service: a bare currency relabels the amount, as Reference did.
      const newCurrency =
        has(raw, 'currency') && body.currency ? this.currencyOf(body.currency)! : undefined;
      if (has(raw, 'value')) {
        patch.value = body.value ?? '0';
        if (newCurrency) patch.currency = newCurrency;
      } else if (newCurrency && newCurrency !== deal.currency) {
        patch.value = deal.value;
        patch.currency = newCurrency;
      }

      // Strict, unlike create: the stage must be one of the deal's own pipeline (TW-API-051 rule 4).
      let moveTo: string | undefined;
      if (has(raw, 'stage_id') && !falsyRef(body.stage_id)) {
        moveTo = await this.stageOfPipeline(deal.pipeline.id, body.stage_id!);
      }

      try {
        await this.deals.update(uuid, patch, 'all');
      } catch (err) {
        if (
          attempt < UPDATE_ATTEMPTS &&
          err instanceof AppError &&
          err.code === ERROR_CODES.ROW_VERSION_CONFLICT
        )
          continue;
        throw err;
      }

      const reason = has(raw, 'lost_reason') ? (body.lost_reason ?? null) : undefined;
      if (moveTo && moveTo !== deal.stage.id) {
        // A move into a lost stage keeps the reason sent with it; into any other stage the engine clears it (Reference's quirk, rule 7).
        await this.deals.moveStage(
          uuid,
          { stageId: moveTo, ...(reason ? { lostReason: reason } : {}) },
          'all',
        );
      } else if (reason !== undefined && deal.status === 'lost') {
        // The status stamps are a database rule (an open or won deal holds no reason), so Reference's "reason on an open deal" is only
        // kept for a lost one: there it replaces the reason.
        await this.setLostReason(uuid, reason);
      }
      return toV1Deal(await this.deals.get(uuid, 'all'));
    }
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const uuid = uuidOrNotFound(id, 'Deal');
    await this.deals.remove(uuid, 'all');
    return { id: uuid, deleted: true };
  }

  /** A lost deal's `lost_reason` alone: no stage change, no status change. Audited like the service's own edits. */
  private async setLostReason(uuid: string, reason: string | null): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT id, lost_reason FROM deals WHERE org_id = ${ctx.orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
      );
      const row = res.rows[0] as { id: string | number; lost_reason: string | null } | undefined;
      if (!row) throw AppError.notFound('Deal');
      if (row.lost_reason === reason) return;
      await tx.execute(
        sql`UPDATE deals SET lost_reason = ${reason}, lost_reason_id = NULL WHERE org_id = ${ctx.orgId} AND id = ${Number(row.id)}`,
      );
      await this.audit.record(tx, {
        module: 'deals',
        recordId: Number(row.id),
        action: 'update',
        delta: { lostReason: { old: row.lost_reason, new: reason } },
      });
    });
  }

  private async stageOfPipeline(pipelineId: string, stageRef: string): Promise<string> {
    const pipeline: PipelineResponse = await this.pipelines.get(pipelineId);
    const stage = isUuid(stageRef)
      ? pipeline.stages.find((s) => s.id === stageRef.toLowerCase())
      : undefined;
    if (!stage) throw unprocessable('DEAL_STAGE_MISMATCH', "Stage not in this deal's pipeline.");
    return stage.id;
  }

  /** The contact's uuid when it is a contact of this workspace, else undefined (Reference links nothing for an unknown id). */
  private async existingContact(
    orgId: number,
    ref: string | null | undefined,
  ): Promise<string | undefined> {
    if (falsyRef(ref) || !isUuid(ref)) return undefined;
    const uuid = ref.toLowerCase();
    const found = await this.db.tx((tx) => this.contacts.resolveContactRef(tx, orgId, uuid));
    return found ? uuid : undefined;
  }

  /** `undefined` leaves the owner to the service; here an omitted or blank owner means none (Reference), a uuid is validated by the service. */
  private ownerRef(ref: string | null | undefined): string | null {
    if (falsyRef(ref)) return null;
    if (!isUuid(ref)) throw invalid('owner_user_id', 'The selected owner_user_id is invalid.');
    return ref.toLowerCase();
  }

  private currencyOf(currency: string | null | undefined): string | undefined {
    if (!currency) return undefined;
    if (!/^[A-Za-z]{3}$/.test(currency))
      throw invalid('currency', 'The currency must be a three-letter code.');
    return currency.toUpperCase();
  }
}
