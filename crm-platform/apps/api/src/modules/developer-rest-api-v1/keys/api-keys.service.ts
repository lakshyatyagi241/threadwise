import { HttpStatus, Injectable } from '@nestjs/common';
import {
  API_KEY_LIMIT_MESSAGE,
  ERROR_CODES,
  type CreateApiKeyInput,
  type CreateApiKeyResponse,
  type ApiKeyResponse,
  type ListApiKeysQuery,
  type ListApiKeysResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';
import { generateRawKey, hashRawKey, keyPrefixOf } from './api-key-secret';
import { toApiKeyResponse } from './api-keys.mapper';
import { ApiKeysRepository } from './api-keys.repository';

const MODULE_KEY = 'api_keys';
/** A key prefix is 8 random characters wide, so a clash is astronomically rare; one retry covers the unique index anyway. */
const PREFIX_ATTEMPTS = 3;

/**
 * The Developers console's keys (TW-API-001 to 004): create, list, revoke. The raw key is returned by `create` and by nothing else; only
 * its hash and a 12-character prefix are stored.
 *
 * Every write records an audit row and an outbox event in the same transaction. Reference wrote neither (a minted key was invisible in the
 * activity log); this is a hardening, listed as intended in the parity file.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ApiKeysRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  async list(query: ListApiKeysQuery): Promise<ListApiKeysResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, {
        limit: query.limit,
        cursor: query.cursor,
        order: query.order,
      });
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toApiKeyResponse), page };
    });
  }

  async create(input: CreateApiKeyInput): Promise<CreateApiKeyResponse> {
    const ctx = RequestContextStore.require();
    if (ctx.userId == null) throw AppError.unauthenticated();

    for (let attempt = 1; ; attempt += 1) {
      const raw = generateRawKey();
      try {
        const row = await this.db.tx(async (tx) => {
          await this.repo.lockForCreate(tx, ctx.orgId);
          await this.assertRoomForAnotherKey(ctx.orgId, await this.repo.countActive(tx, ctx.orgId));

          const created = await this.repo.insert(tx, ctx.orgId, {
            name: input.name,
            keyPrefix: keyPrefixOf(raw),
            keyHash: hashRawKey(raw),
            // The key acts as the member who minted it (Reference `user_id`), so what it creates is theirs.
            userId: ctx.userId,
            createdBy: ctx.userId,
          });
          await this.audit.record(tx, {
            module: MODULE_KEY,
            recordId: created.id,
            action: 'insert',
          });
          await this.outbox.emit(tx, {
            aggregateModule: MODULE_KEY,
            aggregateId: created.id,
            eventType: 'api.key_created',
            payload: { uuid: created.uuid, name: created.name, prefix: created.keyPrefix },
          });
          return created;
        });
        return { key: toApiKeyResponse(row), secret: raw };
      } catch (err) {
        if (attempt < PREFIX_ATTEMPTS && isPrefixClash(err)) continue;
        throw err;
      }
    }
  }

  /** Idempotent: revoking a revoked key answers the same and keeps its first `revoked_at`. */
  async revoke(uuid: string): Promise<ApiKeyResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('API key', uuid);
      if (existing.status === 'revoked') return toApiKeyResponse(existing);

      const revoked = await this.repo.revoke(tx, ctx.orgId, existing.id);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'update',
        delta: { status: { old: 'active', new: 'revoked' } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'api.key_revoked',
        payload: { uuid: existing.uuid, name: existing.name, prefix: existing.keyPrefix },
      });
      return toApiKeyResponse(revoked);
    });
  }

  /**
   * The plan's `api_keys` cap decides how many live keys a workspace holds (Reference: exactly one). With a cap of one the refusal reads as
   * Reference's does. A cap of 0 is unlimited.
   */
  private async assertRoomForAnotherKey(orgId: number, used: number): Promise<void> {
    const cap = await this.entitlements.limit(orgId, 'api_keys');
    if (cap === 0 || used < cap) return;
    throw new AppError(
      ERROR_CODES.PLAN_LIMIT_REACHED,
      cap === 1
        ? API_KEY_LIMIT_MESSAGE
        : `You already have ${used} active API keys, the most your plan allows. Revoke one before creating another.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'limit', message: 'api_keys' },
        { path: 'reason', message: 'limit_reached' },
        { path: 'used', message: String(used) },
        { path: 'limitValue', message: String(cap) },
      ],
    );
  }
}

function isPrefixClash(err: unknown): boolean {
  const e = err as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const code = e.code ?? e.cause?.code;
  const constraint = e.constraint ?? e.cause?.constraint;
  return code === '23505' && constraint === 'uq_api_keys_prefix';
}
