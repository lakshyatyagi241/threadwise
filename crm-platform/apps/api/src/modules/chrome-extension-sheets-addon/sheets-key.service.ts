import { Injectable } from '@nestjs/common';
import type { ExtSheetsKeyIssued, ExtSheetsKeyStatus } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { SheetsAppAccess } from './sheets-app-access.service';
import { SheetsKeyRepository, type SheetsKeyRow } from './sheets-key.repository';
import {
  generateSheetsKey,
  hashSheetsKey,
  maskedSheetsKey,
  sheetsKeySuffix,
} from './sheets-key.rules';

export const SHEETS_KEY_MODULE = 'ext_sheets_key';

export function toKeyStatus(row: SheetsKeyRow | undefined): ExtSheetsKeyStatus {
  const active = !!row?.hash;
  return {
    active,
    suffix: active ? row!.suffix : null,
    masked: active && row!.suffix ? maskedSheetsKey(row!.suffix) : null,
    createdAt: active ? (row!.createdAt?.toISOString() ?? null) : null,
    lastUsedAt: active ? (row!.lastUsedAt?.toISOString() ?? null) : null,
  };
}

/**
 * A member's own Sheets key (WD-EXT-001 to 003): create or replace, look at, revoke. It only ever acts on the signed-in member's row, so
 * there is no id to pass and nobody can reach another member's key. The secret is returned by `generate` and nowhere else; the table holds
 * its hash and last 8 characters. Each change is one transaction with its audit row and outbox event (the secret is in neither).
 */
@Injectable()
export class SheetsKeyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SheetsKeyRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly access: SheetsAppAccess,
  ) {}

  async status(): Promise<ExtSheetsKeyStatus> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => toKeyStatus(await this.repo.read(tx, ctx.orgId, ctx.userId!)));
  }

  /** A previous key stops working in the same transaction. The add-on must be installed in the workspace. */
  async generate(): Promise<ExtSheetsKeyIssued> {
    const ctx = RequestContextStore.require();
    await this.access.require(ctx.orgId);
    const key = generateSheetsKey();
    const next = { hash: hashSheetsKey(key), suffix: sheetsKeySuffix(key) };

    return this.db.tx(async (tx) => {
      const before = await this.repo.read(tx, ctx.orgId, ctx.userId!);
      if (!before) throw AppError.notFound('User');
      const settingsId = await this.repo.set(tx, ctx.orgId, ctx.userId!, next);
      const rotated = !!before.hash;
      await this.audit.record(tx, {
        module: SHEETS_KEY_MODULE,
        recordId: settingsId,
        action: rotated ? 'update' : 'insert',
        delta: { suffix: { old: before.suffix, new: next.suffix } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: SHEETS_KEY_MODULE,
        aggregateId: settingsId,
        eventType: 'ext.sheets_key.generated',
        payload: { user: before.userUuid, rotated },
      });
      const after = await this.repo.read(tx, ctx.orgId, ctx.userId!);
      return { ...toKeyStatus(after), key, rotated };
    });
  }

  /** Revoking when there is no key is not an error: the page's button is safe to press twice. */
  async revoke(): Promise<ExtSheetsKeyStatus> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = await this.repo.read(tx, ctx.orgId, ctx.userId!);
      if (!before) throw AppError.notFound('User');
      if (before.hash) {
        await this.repo.clear(tx, ctx.orgId, ctx.userId!);
        await this.audit.record(tx, {
          module: SHEETS_KEY_MODULE,
          recordId: before.settingsId,
          action: 'delete',
          delta: { suffix: { old: before.suffix, new: null } },
        });
        await this.outbox.emit(tx, {
          aggregateModule: SHEETS_KEY_MODULE,
          aggregateId: before.settingsId,
          eventType: 'ext.sheets_key.revoked',
          payload: { user: before.userUuid },
        });
      }
      return toKeyStatus(await this.repo.read(tx, ctx.orgId, ctx.userId!));
    });
  }
}
