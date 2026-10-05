import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  parseGetaChatbotRecord,
  type GetaChatbotRecord,
  type GetaChatbotSummary,
  type GetaPublishSettings,
  type UpdateGetaPublishSettingsRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { readGetaPublishEnv } from '../../../config/domains/flow-builder-editor.env';
import { RequestContextStore } from '../../../common/context/request-context';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { AppError } from '../../../common/errors/app-error';
import type { BotConsoleCredentials } from '../../../infra/providers/flow-builder-editor/bot-publish.port';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { summaryOf } from './geta-record';
import {
  GetaPublishRepository,
  type SettingsPatch,
  type SettingsRow,
} from './geta-publish.repository';

export const GETA_SETTINGS_MODULE = 'flb-geta-publish';

/** What a push needs, decrypted for the length of one call and never stored or logged. */
export interface PushMaterial {
  credentials: BotConsoleCredentials;
  record: GetaChatbotRecord;
  /** `appid` header value of publish-bot: the record's `bot_id`. */
  botId: string;
}

export type PushMaterialResult =
  { ok: true; material: PushMaterial } | { ok: false; reason: 'not_configured' | 'unreadable' };

const invalid = (path: string, message: string): AppError =>
  new AppError(ERROR_CODES.FLB_GETA_SETTINGS_INVALID, message, HttpStatus.UNPROCESSABLE_ENTITY, [
    { path, message },
  ]);

/**
 * The workspace's Geta console credentials (an addition beyond WaDesk). Where they live: three columns of
 * `flb_geta_publish_settings` (authorization, geta-host, the chatbot record) are sealed with CryptoService (AES-256-GCM, the same
 * as channel tokens and gateway keys); the base URL and origin are plain. A read answers flags and a summary, never a value; a save
 * changes only the fields it names (`null` clears one). The audit row records which fields changed, never what they were.
 */
@Injectable()
export class GetaPublishSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: GetaPublishRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<GetaPublishSettings> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => this.toResponse(await this.repo.findSettings(tx, ctx.orgId)));
  }

  async update(input: UpdateGetaPublishSettingsRequest): Promise<GetaPublishSettings> {
    const ctx = RequestContextStore.require();
    const patch = this.toPatch(input);
    return this.db.tx(async (tx) => {
      const before = await this.repo.findSettings(tx, ctx.orgId);
      const after = await this.repo.saveSettings(tx, ctx.orgId, patch);
      await this.recordChange(tx, after.id, before, after);
      return this.toResponse(after);
    });
  }

  /** Removes every credential of the workspace (the settings form's "Clear"). Flows keep their last sync state. */
  async clear(): Promise<GetaPublishSettings> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = await this.repo.findSettings(tx, ctx.orgId);
      const id = await this.repo.deleteSettings(tx, ctx.orgId);
      if (id !== null && before) {
        await this.audit.record(tx, {
          module: GETA_SETTINGS_MODULE,
          recordId: id,
          action: 'delete',
          delta: this.flagsDelta(before, null),
        });
      }
      return this.toResponse(null);
    });
  }

  // --- used by the sync service and the worker ----------------------------------------------------------------------------

  /** True when a push could be made: the four workspace values (or a per-flow record in place of the workspace one) are present. */
  hasEverything(settings: SettingsRow | null, overrideEnc: string | null): boolean {
    return (
      !!settings?.baseUrl &&
      !!settings.authorizationEnc &&
      !!settings.getaHostEnc &&
      !!(overrideEnc ?? settings.chatbotRecordEnc)
    );
  }

  /** The summary of a sealed record, or null when it cannot be read. */
  summarize(sealed: string | null): GetaChatbotSummary | null {
    const record = this.openRecord(sealed);
    return record ? summaryOf(record) : null;
  }

  /** The one place the secrets are decrypted. */
  async material(tx: Tx, orgId: number, overrideEnc: string | null): Promise<PushMaterialResult> {
    const s = await this.repo.findSettings(tx, orgId);
    if (!this.hasEverything(s, overrideEnc)) return { ok: false, reason: 'not_configured' };
    try {
      const record = this.openRecord(overrideEnc ?? s!.chatbotRecordEnc);
      if (!record) return { ok: false, reason: 'unreadable' };
      return {
        ok: true,
        material: {
          credentials: {
            baseUrl: s!.baseUrl!,
            authorization: this.crypto.decrypt(s!.authorizationEnc!),
            getaHost: this.crypto.decrypt(s!.getaHostEnc!),
            origin: s!.origin,
          },
          record,
          botId: record.bot_id,
        },
      };
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
  }

  /** Validates a pasted record and seals it. Used for the workspace record and for a per-flow one. */
  sealRecord(text: string, path = 'chatbotRecord'): string {
    const parsed = parseGetaChatbotRecord(text);
    if (!parsed.ok) throw invalid(path, parsed.message);
    return this.crypto.encrypt(JSON.stringify(parsed.record));
  }

  // --- internals ----------------------------------------------------------------------------------------------------------

  private openRecord(sealed: string | null): GetaChatbotRecord | null {
    if (!sealed) return null;
    try {
      const parsed = parseGetaChatbotRecord(this.crypto.decrypt(sealed));
      return parsed.ok ? parsed.record : null;
    } catch {
      return null;
    }
  }

  private toPatch(input: UpdateGetaPublishSettingsRequest): SettingsPatch {
    const patch: SettingsPatch = {};
    if (input.baseUrl !== undefined) patch.baseUrl = this.normalizeUrl(input.baseUrl, 'baseUrl');
    if (input.origin !== undefined) patch.origin = this.normalizeUrl(input.origin, 'origin');
    if (input.authorization !== undefined)
      patch.authorizationEnc = input.authorization
        ? this.crypto.encrypt(input.authorization)
        : null;
    if (input.getaHost !== undefined)
      patch.getaHostEnc = input.getaHost ? this.crypto.encrypt(input.getaHost) : null;
    if (input.chatbotRecord !== undefined)
      patch.chatbotRecordEnc =
        input.chatbotRecord === null || input.chatbotRecord.trim() === ''
          ? null
          : this.sealRecord(input.chatbotRecord);
    return patch;
  }

  /** https only (http is allowed for a local stub when the deployment says so), no credentials, query or fragment in the URL. */
  private normalizeUrl(value: string | null, path: string): string | null {
    if (value === null || value.trim() === '') return null;
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw invalid(path, 'Enter a full address such as https://api-core-sandbox.geta.ai');
    }
    const allowHttp = readGetaPublishEnv().allowPrivateHosts;
    if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:'))
      throw invalid(path, 'The address must start with https://');
    if (url.username || url.password || url.search || url.hash)
      throw invalid(path, 'The address must not contain a login, query or fragment.');
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  }

  private toResponse(row: SettingsRow | null): GetaPublishSettings {
    return {
      mode: readGetaPublishEnv().mode,
      baseUrl: row?.baseUrl ?? null,
      origin: row?.origin ?? null,
      authorizationSet: !!row?.authorizationEnc,
      getaHostSet: !!row?.getaHostEnc,
      chatbot: this.summarize(row?.chatbotRecordEnc ?? null),
      configured: this.hasEverything(row, null),
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  }

  private flagsDelta(
    before: SettingsRow | null,
    after: SettingsRow | null,
  ): Record<string, { old: unknown; new: unknown }> {
    const flags = (r: SettingsRow | null) => ({
      baseUrl: !!r?.baseUrl,
      origin: !!r?.origin,
      authorization: !!r?.authorizationEnc,
      getaHost: !!r?.getaHostEnc,
      chatbotRecord: !!r?.chatbotRecordEnc,
    });
    const a = flags(before);
    const b = flags(after);
    const out: Record<string, { old: unknown; new: unknown }> = {};
    for (const k of Object.keys(a) as Array<keyof typeof a>)
      if (a[k] !== b[k]) out[k] = { old: a[k] ? 'set' : 'not set', new: b[k] ? 'set' : 'not set' };
    return out;
  }

  /** Which fields were set, replaced or cleared: names and set / not set flags only, so no value reaches the audit trail. */
  private async recordChange(
    tx: Tx,
    id: number,
    before: SettingsRow | null,
    after: SettingsRow,
  ): Promise<void> {
    const delta = this.flagsDelta(before, after);
    // A replaced secret keeps the same flag; say so, without the value.
    const touched = (b: string | null | undefined, a: string | null) => !!b && !!a && b !== a;
    if (touched(before?.authorizationEnc, after.authorizationEnc))
      delta.authorization = { old: 'set', new: 'replaced' };
    if (touched(before?.getaHostEnc, after.getaHostEnc))
      delta.getaHost = { old: 'set', new: 'replaced' };
    if (touched(before?.chatbotRecordEnc, after.chatbotRecordEnc))
      delta.chatbotRecord = { old: 'set', new: 'replaced' };
    await this.audit.record(tx, {
      module: GETA_SETTINGS_MODULE,
      recordId: id,
      action: before ? 'update' : 'insert',
      delta,
    });
  }
}
