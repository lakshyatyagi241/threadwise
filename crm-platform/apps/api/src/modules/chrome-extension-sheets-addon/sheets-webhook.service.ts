import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  extSheetsCaptureSchema,
  type ExtSheetsCapture,
  type ExtSheetsWebhookRequest,
  type ExtSheetsWebhookResponse,
} from '@crm/contracts';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import type { SheetsCallerState } from './sheets-access';
import { SheetsContactsService } from './sheets-contacts.service';

/** The last call is kept this long, so the setup page can show the columns a sheet sends. */
const CAPTURE_TTL_SECONDS = 24 * 60 * 60;
const SAMPLE_VALUE_MAX = 120;
const SAMPLE_FIELDS_MAX = 60;

const captureKey = (orgId: number, userId: number) => `ext:sheets:capture:${orgId}:${userId}`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The first row's raw cells by column heading, cut short. Anything that is not text, a number or a flag is ignored. */
export function sampleOf(row: unknown): Record<string, string> {
  const values = isRecord(row) && isRecord(row.values) ? row.values : {};
  const out: Record<string, string> = {};
  for (const [heading, value] of Object.entries(values).slice(0, SAMPLE_FIELDS_MAX)) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
    out[heading.slice(0, 80)] = String(value).slice(0, SAMPLE_VALUE_MAX);
  }
  return out;
}

/**
 * The webhook trigger of the add-on (new in this port; modelled on Pabbly's Google Sheets webhook add-on). The sheet posts the rows that
 * were added or changed; a `test` call only proves the connection and records the columns, any other call writes the rows as contacts
 * through the same path as "Push contacts", so identity matching, quota, audit and events are unchanged.
 */
@Injectable()
export class SheetsWebhookService {
  constructor(
    private readonly contacts: SheetsContactsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async receive(
    caller: SheetsCallerState,
    body: ExtSheetsWebhookRequest,
  ): Promise<ExtSheetsWebhookResponse> {
    const sample = sampleOf(body.rows[0]);
    const fields = Object.keys(sample);
    await this.remember(caller, {
      receivedAt: new Date().toISOString(),
      event: body.event,
      sheetName: body.sheet_name ?? null,
      rows: body.rows.length,
      fields,
      sample,
    });
    if (body.event === 'test') {
      return { ok: true, event: 'test', received: body.rows.length, written: false, fields };
    }
    const synced = await this.contacts.sync(caller, {
      default_country_code: body.default_country_code,
      rows: body.rows,
    });
    return {
      ok: true,
      event: body.event,
      received: body.rows.length,
      written: true,
      summary: synced.summary,
      results: synced.results,
      fields,
    };
  }

  async lastCapture(orgId: number, userId: number): Promise<ExtSheetsCapture | null> {
    try {
      const raw = await this.redis.get(captureKey(orgId, userId));
      if (!raw) return null;
      const parsed = extSheetsCaptureSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Diagnostics only: a Redis hiccup must not fail a sync. */
  private async remember(caller: SheetsCallerState, capture: ExtSheetsCapture): Promise<void> {
    try {
      await this.redis.set(
        captureKey(caller.owner.orgId, caller.owner.userId),
        JSON.stringify(capture),
        'EX',
        CAPTURE_TTL_SECONDS,
      );
    } catch {
      // best effort
    }
  }
}
