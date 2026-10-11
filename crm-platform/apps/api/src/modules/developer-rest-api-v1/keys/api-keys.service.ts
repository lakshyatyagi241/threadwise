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
import { permissionsNeededByScopes } from '../auth/api-key-grants';
import { generateRawKey, hashRawKey, keyPrefixOf } from './api-key-secret';
import { toApiKeyResponse } from './api-keys.mapper';
import { ApiKeysRepository } from './api-keys.repository';

const MODULE_KEY = 'api_keys';
/** A key prefix is 8 random characters wide, so a clash is astronomically rare; one retry covers the unique index anyway. */
const PREFIX_ATTEMPTS = 3;

/**
 * The Developers console's keys (WD-API-001 to 004): create, list, revoke. The raw key is returned by `create` and by nothing else; only
 * its hash and a 12-character prefix are stored.
 *
 * Every write records an audit row and an outbox event in the same transaction. WaDesk wrote neither (a minted key was invisible in the
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
    // No scopes (omitted or empty) is a full-access key, as in WaDesk (WD-API-008).
    const scopes = [...new Set(input.scopes ?? [])];
    // An explicit scope list cannot exceed the creator's own permissions. An unrestricted key (`[]`) is still minted, as the product
    // defines it, but the bearer guard caps every call to the creator's live grants (AZ-001), so it can never do more than they can.
    if (scopes.length > 0) this.assertCreatorHolds(ctx.grants, scopes);

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
            scopes,
            // The key acts as the member who minted it (WaDesk `user_id`), so what it creates is theirs.
            userId: ctx.userId,
            createdBy: ctx.userId,
          });
          await this.audit.record(tx, {
            module: MODULE_KEY,
            recordId: created.id,
            action: 'insert',
            delta: { scopes: { old: null, new: scopes } },
          });
          await this.outbox.emit(tx, {
            aggregateModule: MODULE_KEY,
            aggregateId: created.id,
            eventType: 'api.key_created',
            payload: {
              uuid: created.uuid,
              name: created.name,
              prefix: created.keyPrefix,
              scopes,
            },
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

  /**
   * AZ-001: a key's grants derive from its scopes alone, so without this check a member with only `api.keys.create` could mint an
   * unrestricted key and read the whole workspace. Every workspace permission a scope reaches must be one the creator holds. The
   * creator's grants are the ones the permissions guard loaded on this very request. (Use-time capping: see `capGrantsToOwner`.)
   */
  private assertCreatorHolds(
    grants: Map<string, { effect: 'allow' | 'deny'; scope: string }> | undefined,
    scopes: readonly string[],
  ): void {
    const held = (permission: string) => grants?.get(permission)?.effect === 'allow';
    const missing = permissionsNeededByScopes(scopes).filter((n) => !held(n.permission));
    const first = missing[0];
    if (!first) return;
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      `You cannot give a key the "${first.scope}" scope: your role lacks ${first.permission}.`,
      HttpStatus.FORBIDDEN,
      missing.map((n) => ({ path: 'scopes', message: `${n.scope}: ${n.permission}` })),
    );
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
   * The plan's `api_keys` cap decides how many live keys a workspace holds (WaDesk: exactly one). With a cap of one the refusal reads as
   * WaDesk's does. A cap of 0 is unlimited.
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
