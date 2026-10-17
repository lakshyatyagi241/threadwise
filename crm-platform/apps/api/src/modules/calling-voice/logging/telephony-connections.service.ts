import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type CreateTelephonyConnectionInput,
  type TelephonyConnection,
  type TelephonyConnectionSecret,
  type TelephonyProviderInfo,
  type UpdateTelephonyConnectionInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { TelephonyProviderRegistry } from '../../../infra/providers/telephony';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';

const MODULE = 'telephony_connections';
type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;
// drizzle writes a JS array inside sql`` as a parenthesised list, which is not a Postgres array: pass the numbers as JSON instead.
const textArray = (items: readonly string[]) =>
  sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(items)}::jsonb))`;

export const webhookPathOf = (uuid: string): string => `/v2/public/webhooks/telephony/${uuid}`;

const notFound = () =>
  new AppError(
    ERROR_CODES.TELEPHONY_CONNECTION_NOT_FOUND,
    'Telephony connection not found',
    HttpStatus.NOT_FOUND,
  );

/** The secret that signs a provider's callbacks: shown once, kept encrypted, its last four characters kept to tell two apart. */
const newSecret = (): string => `tws_${randomBytes(32).toString('hex')}`;

export interface ConnectionRow {
  id: number;
  uuid: string;
  provider: string;
  label: string;
  numbers: string[];
  status: 'active' | 'disabled';
  playsRecordingNotice: boolean;
}

export const toConnection = (r: Row): TelephonyConnection => ({
  id: String(r.uuid),
  provider: String(r.provider),
  label: String(r.label),
  numbers: (r.numbers as string[] | null) ?? [],
  status: r.status === 'disabled' ? 'disabled' : 'active',
  secretHint: String(r.secret_hint),
  playsRecordingNotice: r.plays_recording_notice === true,
  lastEventAt: r.last_event_at ? new Date(r.last_event_at as string).toISOString() : null,
  webhookPath: webhookPathOf(String(r.uuid)),
  createdAt: new Date(r.created_at as string).toISOString(),
});

/**
 * A workspace's telephony connections (`call.logging.manage`): a provider key, a label, the numbers it serves, and the secret that signs
 * its callbacks. The secret is generated here and shown once (creation, rotation); only its ciphertext and last four characters are kept.
 * No provider credential is ever stored. Every change is audited and emitted.
 */
@Injectable()
export class TelephonyConnectionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: TelephonyProviderRegistry,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  providers(): TelephonyProviderInfo[] {
    return this.registry.available().map((p) => ({
      key: p.key,
      label: p.label,
      supportsClickToCall: p.supportsClickToCall,
    }));
  }

  async list(): Promise<TelephonyConnection[]> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT uuid, provider, label, numbers, status, secret_hint, plays_recording_notice, last_event_at, created_at
        FROM telephony_connections WHERE org_id = ${orgId} ORDER BY created_at DESC, id DESC`);
      return rowsOf(res).map(toConnection);
    });
  }

  async create(input: CreateTelephonyConnectionInput): Promise<TelephonyConnectionSecret> {
    const ctx = RequestContextStore.require();
    if (!this.registry.get(input.provider)) {
      throw new AppError(
        ERROR_CODES.TELEPHONY_PROVIDER_UNKNOWN,
        'No telephony provider is registered under that key.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'provider', message: 'unknown' }],
      );
    }
    const secret = newSecret();
    return this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        INSERT INTO telephony_connections (org_id, provider, label, numbers, webhook_secret_cipher, secret_hint, plays_recording_notice, created_by)
        VALUES (${ctx.orgId}, ${input.provider}, ${input.label}, ${textArray(input.numbers)}, ${this.crypto.encrypt(secret)},
                ${secret.slice(-4)}, ${input.playsRecordingNotice}, ${ctx.userId})
        RETURNING id, uuid, provider, label, numbers, status, secret_hint, plays_recording_notice, last_event_at, created_at`);
      const row = rowsOf(res)[0]!;
      await this.audit.record(tx, {
        module: MODULE,
        recordId: Number(row.id),
        action: 'insert',
        delta: {
          provider: { old: null, new: input.provider },
          label: { old: null, new: input.label },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: Number(row.id),
        eventType: 'telephony.connection.created',
        payload: { uuid: String(row.uuid), provider: input.provider },
      });
      return { connection: toConnection(row), secret };
    });
  }

  async update(uuid: string, input: UpdateTelephonyConnectionInput): Promise<TelephonyConnection> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = await this.lock(tx, ctx.orgId, uuid);
      const res = await tx.execute(sql`
        UPDATE telephony_connections
        SET label = ${input.label ?? sql`label`},
            numbers = ${input.numbers ? textArray(input.numbers) : sql`numbers`},
            plays_recording_notice = ${input.playsRecordingNotice ?? sql`plays_recording_notice`},
            status = ${input.status ?? sql`status`}
        WHERE org_id = ${ctx.orgId} AND id = ${before.id}
        RETURNING id, uuid, provider, label, numbers, status, secret_hint, plays_recording_notice, last_event_at, created_at`);
      const row = rowsOf(res)[0]!;
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (input.label !== undefined && input.label !== before.label) {
        delta.label = { old: before.label, new: input.label };
      }
      if (input.status !== undefined && input.status !== before.status) {
        delta.status = { old: before.status, new: input.status };
      }
      if (
        input.playsRecordingNotice !== undefined &&
        input.playsRecordingNotice !== before.playsRecordingNotice
      ) {
        delta.playsRecordingNotice = {
          old: before.playsRecordingNotice,
          new: input.playsRecordingNotice,
        };
      }
      if (input.numbers !== undefined) {
        delta.numbers = { old: before.numbers.length, new: input.numbers.length };
      }
      await this.audit.record(tx, { module: MODULE, recordId: before.id, action: 'update', delta });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: before.id,
        eventType: 'telephony.connection.updated',
        payload: { uuid, status: String(row.status) },
      });
      return toConnection(row);
    });
  }

  /** A new secret; the old one stops working at once. */
  async rotate(uuid: string): Promise<TelephonyConnectionSecret> {
    const ctx = RequestContextStore.require();
    const secret = newSecret();
    return this.db.tx(async (tx) => {
      const before = await this.lock(tx, ctx.orgId, uuid);
      const res = await tx.execute(sql`
        UPDATE telephony_connections
        SET webhook_secret_cipher = ${this.crypto.encrypt(secret)}, secret_hint = ${secret.slice(-4)}
        WHERE org_id = ${ctx.orgId} AND id = ${before.id}
        RETURNING id, uuid, provider, label, numbers, status, secret_hint, plays_recording_notice, last_event_at, created_at`);
      await this.audit.record(tx, {
        module: MODULE,
        recordId: before.id,
        action: 'update',
        delta: { secret: { old: '[kept]', new: '[rotated]' } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: before.id,
        eventType: 'telephony.connection.secret_rotated',
        payload: { uuid },
      });
      return { connection: toConnection(rowsOf(res)[0]!), secret };
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const before = await this.lock(tx, ctx.orgId, uuid);
      // The calls it reported stay (their connection link is cleared by the database); its pending click-to-calls go with it.
      await tx.execute(
        sql`DELETE FROM telephony_connections WHERE org_id = ${ctx.orgId} AND id = ${before.id}`,
      );
      await this.audit.record(tx, {
        module: MODULE,
        recordId: before.id,
        action: 'delete',
        delta: { provider: { old: before.provider, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: before.id,
        eventType: 'telephony.connection.deleted',
        payload: { uuid },
      });
    });
  }

  /** A connection of this workspace by uuid (404 for another workspace's), for the click-to-call. */
  async find(tx: Tx, orgId: number, uuid: string, lock = false): Promise<ConnectionRow | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, provider, label, numbers, status, plays_recording_notice
      FROM telephony_connections WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE` : sql``}`);
    const r = rowsOf(res)[0];
    return r
      ? {
          id: Number(r.id),
          uuid: String(r.uuid),
          provider: String(r.provider),
          label: String(r.label),
          numbers: (r.numbers as string[] | null) ?? [],
          status: r.status === 'disabled' ? 'disabled' : 'active',
          playsRecordingNotice: r.plays_recording_notice === true,
        }
      : null;
  }

  private async lock(tx: Tx, orgId: number, uuid: string): Promise<ConnectionRow> {
    const row = await this.find(tx, orgId, uuid, true);
    if (!row) throw notFound();
    return row;
  }
}

export { notFound as connectionNotFound };
