import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  ClaimUsernameInput,
  CreateQrCodeInput,
  WabaQrCode,
  WabaQrCodeList,
  WabaSyncHistoryResult,
  WabaUsername,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import {
  WABA_ADMIN,
  type WabaAdminPort,
  type WabaConnection,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import {
  WabaApiError,
  translateConnectError,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { WabaConnectService } from './waba-connect.service';
import { WabaConnectionsRepository } from './waba-connections.repository';
import { usernameOf, usernameProblem, usernameSuggestions } from './waba-extras-rules';

const MODULE = 'wa_provider_configs';

/**
 * The number extras that call Meta on a connected number's behalf (TW-WABA-025, 027, 028): the business username, click-to-chat QR
 * codes and the coexistence history re-sync. Each reads the number inside the caller's tenant, then talks to Meta outside any
 * transaction (a slow Meta never holds a database connection). The token never leaves the server.
 */
@Injectable()
export class WabaExtrasService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WabaConnectionsRepository,
    private readonly audit: AuditService,
    private readonly connections: WabaConnectService,
    @Inject(WABA_ADMIN) private readonly admin: WabaAdminPort,
  ) {}

  // --- username (TW-WABA-025) --------------------------------------------------------------------

  async username(uuid: string): Promise<WabaUsername> {
    const { row, conn } = await this.number(uuid);
    const state = usernameOf(row.meta_json);
    if (state.username) return { ...state, suggestions: [] };
    // Suggestions are a convenience: whatever fails here must never break the card.
    const reserved = await this.admin.getReservedUsername(conn).catch(() => null);
    const brand = row.display_label ?? null;
    return { ...state, suggestions: usernameSuggestions(reserved, brand) };
  }

  async claimUsername(uuid: string, input: ClaimUsernameInput): Promise<WabaUsername> {
    const handle = input.username.trim().toLowerCase();
    const problem = usernameProblem(handle);
    // Meta's rules are checked here first: a handle that cannot be valid never costs a call.
    if (problem) throw AppError.validation(problem);
    const { row, conn } = await this.number(uuid);
    let status: 'reserved' | 'approved';
    try {
      status = await this.admin.claimUsername(conn, handle);
    } catch (e) {
      throw this.usernameFailure(e);
    }
    await this.patch(
      row.id,
      row.meta_json,
      {
        wa_username: handle,
        wa_username_status: status,
        wa_username_at: new Date().toISOString(),
      },
      'username_claimed',
    );
    return { username: handle, status, suggestions: [] };
  }

  async releaseUsername(uuid: string): Promise<WabaUsername> {
    const { row, conn } = await this.number(uuid);
    // Meta failing to release must not leave the screen stuck: the local record is always cleared.
    await this.admin.releaseUsername(conn).catch(() => undefined);
    await this.patch(
      row.id,
      row.meta_json,
      {
        wa_username: null,
        wa_username_status: null,
        wa_username_at: null,
      },
      'username_released',
    );
    return { username: null, status: null, suggestions: [] };
  }

  // --- QR codes (TW-WABA-027) --------------------------------------------------------------------

  async listQrCodes(uuid: string): Promise<WabaQrCodeList> {
    const { conn } = await this.number(uuid);
    return {
      items: await this.call('Could not read the QR codes', () => this.admin.listQrCodes(conn)),
    };
  }

  async createQrCode(uuid: string, input: CreateQrCodeInput): Promise<WabaQrCode> {
    const { conn } = await this.number(uuid);
    return this.call('Could not create the QR code', () =>
      this.admin.createQrCode(conn, input.prefilledMessage),
    );
  }

  async deleteQrCode(uuid: string, code: string): Promise<void> {
    const { conn } = await this.number(uuid);
    // Reference ignored failures here: a code that is already gone is the outcome the person wanted.
    await this.admin.deleteQrCode(conn, code).catch(() => undefined);
  }

  // --- coexistence history (TW-WABA-028) ---------------------------------------------------------

  /**
   * Meta has no API to pull history; it pushes once, shortly after onboarding. Re-subscribing is the only lever, so this does that
   * and reports how many historical messages the inbox already holds.
   */
  async syncHistory(uuid: string): Promise<WabaSyncHistoryResult> {
    const { row } = await this.number(uuid);
    const result = await this.connections.resubscribe(uuid);
    const { orgId } = RequestContextStore.require();
    const imported = await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT count(*)::int AS n
          FROM messages m JOIN channels c ON c.org_id = m.org_id AND c.id = m.channel_id
         WHERE m.org_id = ${orgId} AND c.kind = 'whatsapp_waba' AND c.external_id = ${row.uuid}
           AND m.meta ->> 'history_sync' = 'true'`);
      return Number((res.rows[0] as { n?: number } | undefined)?.n ?? 0);
    });
    return {
      requested: true,
      importedMessages: imported,
      inboundWired: result.connection.inboundWired ?? null,
      warnings: result.warnings,
    };
  }

  // --- internals ---------------------------------------------------------------------------------

  private async number(uuid: string) {
    const { orgId } = RequestContextStore.require();
    const resolved = await this.db.tx((tx) =>
      this.connections.resolveConnection(tx, orgId, { uuid }),
    );
    if (!resolved) throw AppError.notFound('WhatsApp number', uuid);
    if (!resolved.conn) {
      throw AppError.validation(
        'This WhatsApp number has no stored token or phone number id. Reconnect it first.',
      );
    }
    const row = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid));
    if (!row) throw AppError.notFound('WhatsApp number', uuid);
    return { row, conn: resolved.conn as WabaConnection };
  }

  private async patch(
    id: number,
    current: Record<string, unknown> | null,
    metaPatch: Record<string, unknown>,
    action: string,
  ): Promise<void> {
    const { orgId } = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      await this.repo.update(tx, orgId, id, { metaPatch });
      await this.audit.record(tx, {
        module: MODULE,
        recordId: id,
        action: 'update',
        delta: {
          [action]: { old: current?.wa_username ?? null, new: metaPatch.wa_username ?? null },
        },
      });
    });
  }

  private async call<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const err = e instanceof WabaApiError ? e : WabaApiError.network(e);
      throw AppError.validation(`${what}: ${translateConnectError(err)}`);
    }
  }

  /** Meta answers error 100 (or "does not exist" / "does not support this operation") when usernames are not available to the number. */
  private usernameFailure(e: unknown): AppError {
    const err = e instanceof WabaApiError ? e : WabaApiError.network(e);
    if (err.code === 100 || /does not exist|does not support this operation/i.test(err.message)) {
      return AppError.validation(
        'WhatsApp did not accept the username. Register the number on the Cloud API first. Usernames are a limited rollout and may not be enabled for this account or region; that is a WhatsApp limit, not a problem with the handle.',
      );
    }
    return AppError.validation(`Could not claim the username: ${translateConnectError(err)}`);
  }
}
