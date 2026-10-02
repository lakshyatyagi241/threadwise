import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  findAiProvider,
  type PlatformAiKeyItem,
  type PlatformAiKeysResponse,
  type UpdatePlatformAiKeyInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService, PlatformStore } from '../auth';
import { mergeExtras, parseExtras } from './ai-rules';
import { KeyVault } from './key-vault';

/** `admin_ai_keys` as selected here. */
export interface PlatformKeyRow {
  id: number;
  uuid: string;
  provider: string;
  name: string;
  api_key: string | null;
  key_last4: string | null;
  default_model: string | null;
  extra_config: string | null;
  is_active: boolean;
  sort_order: number;
  row_version: number;
  updated_at: string;
}

export const PLATFORM_KEY_COLUMNS = sql.raw(
  'id, uuid, provider, name, api_key, key_last4, default_model, extra_config, is_active, sort_order, row_version, updated_at',
);

/**
 * The platform's own provider keys (WD-AIADM-001..004, 009): the one global key per vendor that workspaces without
 * their own key fall back to. Operator-only; every read and write is one privileged transaction through the
 * platform door, and every change records a security event in the same transaction (WaDesk wrote none).
 *
 * The secret is write-only: nothing here returns it, and the audit payload never carries it.
 */
@Injectable()
export class PlatformKeysService {
  constructor(
    private readonly store: PlatformStore,
    private readonly vault: KeyVault,
    private readonly audit: AuthAuditService,
  ) {}

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  // --- reads ---------------------------------------------------------------------------------------------------------

  /** Every provider in display order with the four-count status strip. A read never writes (the rows are seeded). */
  async list(): Promise<PlatformAiKeysResponse> {
    const rows = await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT ${PLATFORM_KEY_COLUMNS} FROM admin_ai_keys ORDER BY sort_order, provider`,
      );
      return res.rows as unknown as PlatformKeyRow[];
    });
    const data = rows.map((r) => this.toItem(r));
    return {
      data,
      summary: {
        providers: data.length,
        active: data.filter((i) => i.isActive).length,
        ready: data.filter((i) => i.isActive && i.hasKey).length,
        noKey: data.filter((i) => !i.hasKey).length,
      },
    };
  }

  // --- writes --------------------------------------------------------------------------------------------------------

  /**
   * Saves a provider card (WD-AIADM-003). Blank key keeps the saved one. A save that gives a keyless provider a key
   * switches it on (WaDesk switched on any provider with a key on any save, so editing the sort order of a provider
   * the admin had deliberately disabled re-enabled it; here only the keyless-to-keyed step does). Removing the key
   * switches it off with it.
   */
  async update(uuid: string, input: UpdatePlatformAiKeyInput): Promise<PlatformAiKeyItem> {
    const operatorId = this.operatorId();
    return this.store.tx(async (tx) => {
      const row = await this.lock(tx, uuid);
      if (row.row_version !== input.rowVersion)
        throw AppError.rowVersionConflict('AI provider key');

      const def = findAiProvider(row.provider);
      const hadKey = this.vault.read(row.api_key, row.provider).state === 'readable';

      const newKey = input.apiKey?.trim() ? input.apiKey.trim() : null;
      const sealed = newKey ? this.vault.seal(newKey) : null;
      const apiKey = input.removeKey ? null : (sealed?.cipher ?? row.api_key);
      const keyLast4 = input.removeKey ? null : sealed ? sealed.last4 : row.key_last4;
      const hasKeyNow = input.removeKey ? false : newKey ? true : hadKey;

      const extras = mergeExtras(
        parseExtras(row.extra_config),
        { maxTokens: input.maxTokens, extraModels: input.extraModels },
        def?.maxTokensField ?? false,
      );
      const defaultModel =
        input.defaultModel === undefined ? row.default_model : input.defaultModel;
      const sortOrder = input.sortOrder ?? row.sort_order;
      const isActive = input.removeKey ? false : !hadKey && hasKeyNow ? true : row.is_active;

      const res = await tx.execute(sql`
        UPDATE admin_ai_keys SET
          api_key = ${apiKey}, key_last4 = ${keyLast4}, default_model = ${defaultModel},
          extra_config = ${extras.json}, sort_order = ${sortOrder}, is_active = ${isActive}
        WHERE id = ${row.id} AND row_version = ${input.rowVersion}
        RETURNING ${PLATFORM_KEY_COLUMNS}
      `);
      const next = res.rows[0] as unknown as PlatformKeyRow | undefined;
      if (!next) throw AppError.rowVersionConflict('AI provider key');

      const changes: Record<string, unknown> = {};
      if (defaultModel !== row.default_model)
        changes.defaultModel = { from: row.default_model, to: defaultModel };
      if (sortOrder !== row.sort_order) changes.sortOrder = { from: row.sort_order, to: sortOrder };
      if (isActive !== row.is_active) changes.isActive = { from: row.is_active, to: isActive };
      const before = parseExtras(row.extra_config);
      if (before.maxTokens !== extras.next.maxTokens)
        changes.ceiling = { from: before.maxTokens, to: extras.next.maxTokens };
      if (JSON.stringify(before.models) !== JSON.stringify(extras.next.models))
        changes.extraModels = { from: before.models, to: extras.next.models };
      const keyEvent = input.removeKey ? 'removed' : newKey ? 'replaced' : null;
      if (keyEvent) changes.key = keyEvent;

      if (Object.keys(changes).length > 0) {
        await this.audit.record(tx, {
          event: keyEvent === 'removed' ? 'platform.ai_key.removed' : 'platform.ai_key.updated',
          status: 'info',
          actorType: 'platform_operator',
          actorId: operatorId,
          payload: { provider: row.provider, changes },
        });
      }
      return this.toItem(next);
    });
  }

  /** Turns a provider on or off (WD-AIADM-004). Idempotent: asking for the state it is in changes nothing. */
  async setActive(uuid: string, isActive: boolean): Promise<PlatformAiKeyItem> {
    const operatorId = this.operatorId();
    return this.store.tx(async (tx) => {
      const row = await this.lock(tx, uuid);
      if (row.is_active === isActive) return this.toItem(row);

      if (isActive && this.vault.read(row.api_key, row.provider).state !== 'readable') {
        throw new AppError(
          ERROR_CODES.AIADM_KEY_REQUIRED,
          'Add an API key before activating this provider.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'provider', message: row.provider }],
        );
      }
      const res = await tx.execute(sql`
        UPDATE admin_ai_keys SET is_active = ${isActive} WHERE id = ${row.id}
        RETURNING ${PLATFORM_KEY_COLUMNS}
      `);
      await this.audit.record(tx, {
        event: isActive ? 'platform.ai_key.activated' : 'platform.ai_key.deactivated',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { provider: row.provider },
      });
      return this.toItem(res.rows[0] as unknown as PlatformKeyRow);
    });
  }

  // --- internals -----------------------------------------------------------------------------------------------------

  private async lock(tx: Tx, uuid: string): Promise<PlatformKeyRow> {
    const res = await tx.execute(sql`
      SELECT ${PLATFORM_KEY_COLUMNS} FROM admin_ai_keys WHERE uuid = ${uuid}::uuid FOR UPDATE
    `);
    const row = res.rows[0] as unknown as PlatformKeyRow | undefined;
    if (!row) throw AppError.notFound('AI provider key', uuid);
    return row;
  }

  toItem(row: PlatformKeyRow): PlatformAiKeyItem {
    const def = findAiProvider(row.provider);
    const read = this.vault.read(row.api_key, row.provider);
    const extras = parseExtras(row.extra_config);
    return {
      id: row.uuid,
      provider: row.provider as PlatformAiKeyItem['provider'],
      name: row.name,
      group: def?.group ?? 'llm',
      isActive: row.is_active,
      hasKey: read.state === 'readable',
      keyUnreadable: read.state === 'unreadable',
      keyLast4: read.state === 'readable' ? row.key_last4 : null,
      defaultModel: row.default_model,
      sortOrder: row.sort_order,
      maxTokens: extras.maxTokens,
      supportsMaxTokens: def?.maxTokensField ?? false,
      extraModels: extras.models,
      modelChoices: [...(def?.models ?? [])],
      rowVersion: row.row_version,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
