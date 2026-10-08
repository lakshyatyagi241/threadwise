import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type CreateWebhookTargetInput,
  type UpdateWebhookTargetInput,
  type WebhookDeliveryResult,
  type WebhookFailureItem,
  type WebhookFailuresQuery,
  type WebhookTargetItem,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import { AuthAuditService, PlatformStore } from '../auth';
import { deliver } from './deliver';
import { assertPublicTarget } from './url-guard';
import { WebhookFanoutService } from './webhook-fanout.service';
import {
  TARGET_COLUMNS,
  WebhookTargetsRepository,
  type TargetRow,
} from './webhook-targets.repository';

/** The body a test send carries: a status-only Meta envelope for a phone number that does not exist. */
const TEST_BODY = Buffer.from(
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '0',
        time: 0,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '0', phone_number_id: '0' },
              statuses: [],
            },
          },
        ],
      },
    ],
  }),
);

const REPLAY_COLUMNS = sql.raw(
  't.id, t.uuid, t.name, t.url, t.auth_header_name, t.auth_header_value, t.auth_header_last4, t.is_active, t.field_filter, ' +
    't.timeout_ms, t.max_attempts, t.success_count, t.failure_count, t.last_status, t.last_error, t.last_success_at, ' +
    't.last_failure_at, t.row_version, t.updated_at',
);

/** A Postgres text[] literal, passed as ONE parameter (drizzle would spread a JS array into a record). */
const pgTextArray = (v: string[]) =>
  `{${v.map((x) => `"${x.replace(/[\\"]/g, '\\$&')}"`).join(',')}}`;

const last4 = (v: string) => (v.length >= 4 ? v.slice(-4) : null);

/**
 * The operator's target list (create, edit, switch off, delete) plus test send and replay of failed deliveries.
 * Super admin only; every write records a security event in the same transaction. The header value is write-only.
 */
@Injectable()
export class WebhookTargetsService {
  constructor(
    private readonly store: PlatformStore,
    private readonly crypto: CryptoService,
    private readonly audit: AuthAuditService,
    private readonly repo: WebhookTargetsRepository,
    private readonly fanout: WebhookFanoutService,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
  ) {}

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  private async requirePublicUrl(url: string): Promise<void> {
    const problem = await assertPublicTarget(url);
    if (problem)
      throw new AppError(ERROR_CODES.WFWD_URL_REJECTED, problem, HttpStatus.UNPROCESSABLE_ENTITY, [
        { path: 'url', message: problem },
      ]);
  }

  private changed(): void {
    this.fanout.invalidate();
    this.repo.forget();
  }

  async list(): Promise<WebhookTargetItem[]> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${TARGET_COLUMNS},
          (SELECT count(*) FROM webhook_forward_failures f WHERE f.target_id = t.id AND f.replayed_at IS NULL) AS pending_failures
        FROM webhook_forward_targets t ORDER BY id
      `);
      return (res.rows as unknown as Array<TargetRow & { pending_failures: number | string }>).map(
        (r) => this.toItem(r, Number(r.pending_failures)),
      );
    });
  }

  async create(input: CreateWebhookTargetInput): Promise<WebhookTargetItem> {
    const operatorId = this.operatorId();
    await this.requirePublicUrl(input.url);
    const sealed = input.authHeaderValue ? this.crypto.encrypt(input.authHeaderValue) : null;
    const item = await this.store.tx(async (tx) => {
      let row: TargetRow | undefined;
      try {
        const res = await tx.execute(sql`
          INSERT INTO webhook_forward_targets
            (name, url, auth_header_name, auth_header_value, auth_header_last4, is_active, field_filter, timeout_ms, max_attempts)
          VALUES (${input.name}, ${input.url}, ${input.authHeaderName ?? null}, ${sealed},
            ${input.authHeaderValue ? last4(input.authHeaderValue) : null}, ${input.isActive},
            ${input.fieldFilter.length ? sql`${pgTextArray(input.fieldFilter)}::text[]` : null}, ${input.timeoutMs}, ${input.maxAttempts})
          RETURNING ${TARGET_COLUMNS}
        `);
        row = res.rows[0] as unknown as TargetRow | undefined;
      } catch (err) {
        throw this.mapUnique(err);
      }
      await this.audit.record(tx, {
        event: 'platform.webhook_target.created',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { name: input.name, url: input.url, isActive: input.isActive },
      });
      return this.toItem(row!, 0);
    });
    this.changed();
    return item;
  }

  async update(uuid: string, input: UpdateWebhookTargetInput): Promise<WebhookTargetItem> {
    const operatorId = this.operatorId();
    if (input.url !== undefined) await this.requirePublicUrl(input.url);
    const item = await this.store.tx(async (tx) => {
      const row = await this.lock(tx, uuid);
      if (row.row_version !== input.rowVersion) throw AppError.rowVersionConflict('Webhook target');

      let headerName = row.auth_header_name;
      let headerCipher = row.auth_header_value;
      let headerLast4 = row.auth_header_last4;
      if (input.removeAuthHeader) {
        headerName = headerCipher = headerLast4 = null;
      } else {
        if (input.authHeaderName !== undefined) headerName = input.authHeaderName;
        if (input.authHeaderValue) {
          headerCipher = this.crypto.encrypt(input.authHeaderValue);
          headerLast4 = last4(input.authHeaderValue);
        }
        if (Boolean(headerName) !== Boolean(headerCipher))
          throw AppError.validation('A header needs both a name and a value', [
            { path: 'authHeaderValue', message: 'Send the value together with the name' },
          ]);
      }

      const next = {
        name: input.name ?? row.name,
        url: input.url ?? row.url,
        isActive: input.isActive ?? row.is_active,
        filter: input.fieldFilter ?? row.field_filter ?? [],
        timeoutMs: input.timeoutMs ?? row.timeout_ms,
        maxAttempts: input.maxAttempts ?? row.max_attempts,
      };
      let out: TargetRow | undefined;
      try {
        const res = await tx.execute(sql`
          UPDATE webhook_forward_targets SET
            name = ${next.name}, url = ${next.url}, is_active = ${next.isActive},
            auth_header_name = ${headerName}, auth_header_value = ${headerCipher}, auth_header_last4 = ${headerLast4},
            field_filter = ${next.filter.length ? sql`${pgTextArray(next.filter)}::text[]` : null},
            timeout_ms = ${next.timeoutMs}, max_attempts = ${next.maxAttempts}
          WHERE id = ${row.id} AND row_version = ${input.rowVersion}
          RETURNING ${TARGET_COLUMNS}
        `);
        out = res.rows[0] as unknown as TargetRow | undefined;
      } catch (err) {
        throw this.mapUnique(err);
      }
      if (!out) throw AppError.rowVersionConflict('Webhook target');

      const changes: Record<string, unknown> = {};
      if (next.name !== row.name) changes.name = { from: row.name, to: next.name };
      if (next.url !== row.url) changes.url = { from: row.url, to: next.url };
      if (next.isActive !== row.is_active)
        changes.isActive = { from: row.is_active, to: next.isActive };
      if (JSON.stringify(next.filter) !== JSON.stringify(row.field_filter ?? []))
        changes.fieldFilter = { from: row.field_filter ?? [], to: next.filter };
      if (headerCipher !== row.auth_header_value)
        changes.authHeader = headerCipher ? 'replaced' : 'removed';
      if (Object.keys(changes).length > 0) {
        await this.audit.record(tx, {
          event: 'platform.webhook_target.updated',
          status: 'info',
          actorType: 'platform_operator',
          actorId: operatorId,
          payload: { name: row.name, changes },
        });
      }
      return this.toItem(out, 0);
    });
    this.changed();
    return item;
  }

  async remove(uuid: string): Promise<void> {
    const operatorId = this.operatorId();
    await this.store.tx(async (tx) => {
      const row = await this.lock(tx, uuid);
      await tx.execute(sql`DELETE FROM webhook_forward_targets WHERE id = ${row.id}`);
      await this.audit.record(tx, {
        event: 'platform.webhook_target.deleted',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { name: row.name, url: row.url },
      });
    });
    this.changed();
  }

  /** Sends a harmless, signed sample to the target and reports what it answered. Works for a switched-off target too. */
  async test(uuid: string): Promise<WebhookDeliveryResult> {
    const row = await this.store.tx((tx) => this.lock(tx, uuid, false));
    const secret = this.env.META_APP_SECRET;
    const signature = secret
      ? `sha256=${createHmac('sha256', secret).update(TEST_BODY).digest('hex')}`
      : null;
    const out = await deliver(this.repo.toDelivery(row), {
      body: TEST_BODY,
      signatureHeader: signature,
      contentType: 'application/json',
      extraHeaders: { 'x-webhook-fanout-test': '1' },
    });
    return { ok: out.ok, statusCode: out.statusCode, error: out.error, latencyMs: out.latencyMs };
  }

  async failures(query: WebhookFailuresQuery): Promise<WebhookFailureItem[]> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT f.uuid, t.uuid AS target_uuid, t.name AS target_name, f.attempts, f.status_code, f.error,
               octet_length(f.body) AS body_bytes, f.created_at, f.replayed_at
        FROM webhook_forward_failures f JOIN webhook_forward_targets t ON t.id = f.target_id
        WHERE ${query.targetId ? sql`t.uuid = ${query.targetId}::uuid` : sql`true`}
        ORDER BY f.created_at DESC, f.id DESC LIMIT ${query.limit}
      `);
      return (res.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.uuid),
        targetId: String(r.target_uuid),
        targetName: String(r.target_name),
        attempts: Number(r.attempts),
        statusCode: r.status_code === null ? null : Number(r.status_code),
        error: (r.error as string | null) ?? null,
        bodyBytes: Number(r.body_bytes),
        createdAt: new Date(r.created_at as string).toISOString(),
        replayedAt: r.replayed_at ? new Date(r.replayed_at as string).toISOString() : null,
      }));
    });
  }

  /** Sends a kept failure again, right now. Marked replayed only when the target answers 2xx. */
  async replay(failureUuid: string): Promise<WebhookDeliveryResult> {
    const operatorId = this.operatorId();
    const found = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT f.id AS failure_id, f.body, f.signature_header, f.content_type, ${REPLAY_COLUMNS}
        FROM webhook_forward_failures f JOIN webhook_forward_targets t ON t.id = f.target_id
        WHERE f.uuid = ${failureUuid}::uuid
      `);
      return res.rows[0] as unknown as
        | (TargetRow & {
            failure_id: number | string;
            body: Buffer;
            signature_header: string | null;
            content_type: string | null;
          })
        | undefined;
    });
    if (!found) throw AppError.notFound('Failed delivery', failureUuid);
    const out = await deliver(this.repo.toDelivery(found), {
      body: found.body,
      signatureHeader: found.signature_header,
      contentType: found.content_type,
      extraHeaders: { 'x-webhook-fanout-replay': '1' },
    });
    if (out.ok) {
      await this.store.tx(async (tx) => {
        await tx.execute(
          sql`UPDATE webhook_forward_failures SET replayed_at = now() WHERE id = ${Number(found.failure_id)}`,
        );
        await this.audit.record(tx, {
          event: 'platform.webhook_target.replayed',
          status: 'info',
          actorType: 'platform_operator',
          actorId: operatorId,
          payload: { name: found.name, failure: failureUuid },
        });
      });
    }
    return { ok: out.ok, statusCode: out.statusCode, error: out.error, latencyMs: out.latencyMs };
  }

  // --- internals -----------------------------------------------------------------------------------------------------

  private async lock(tx: Tx, uuid: string, forUpdate = true): Promise<TargetRow> {
    const res = await tx.execute(
      forUpdate
        ? sql`SELECT ${TARGET_COLUMNS} FROM webhook_forward_targets WHERE uuid = ${uuid}::uuid FOR UPDATE`
        : sql`SELECT ${TARGET_COLUMNS} FROM webhook_forward_targets WHERE uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as unknown as TargetRow | undefined;
    if (!row) throw AppError.notFound('Webhook target', uuid);
    return row;
  }

  private mapUnique(err: unknown): unknown {
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.code ?? e.cause?.code) === '23505')
      return new AppError(
        ERROR_CODES.CONFLICT,
        'A target with this name already exists.',
        HttpStatus.CONFLICT,
      );
    return err;
  }

  private toItem(row: TargetRow, pendingFailures: number): WebhookTargetItem {
    return {
      id: row.uuid,
      name: row.name,
      url: row.url,
      isActive: row.is_active,
      authHeaderName: row.auth_header_name,
      hasAuthHeader: Boolean(row.auth_header_value),
      authHeaderLast4: row.auth_header_last4,
      fieldFilter: row.field_filter ?? [],
      timeoutMs: row.timeout_ms,
      maxAttempts: row.max_attempts,
      successCount: Number(row.success_count),
      failureCount: Number(row.failure_count),
      lastStatus: row.last_status,
      lastError: row.last_error,
      lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
      lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at).toISOString() : null,
      pendingFailures,
      rowVersion: row.row_version,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
