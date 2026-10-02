import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PlatformStore } from './platform-store';

interface Row {
  value: unknown;
  isSecret: boolean;
}

const CACHE_MS = 5_000;

/**
 * Typed access to `platform_settings` (TW-SET's store, built early because the
 * auth domain needs it; SET adopts it later).
 *
 * Reads are served from a 5-second in-process snapshot of the whole (small)
 * table. A write drops the snapshot of THIS process at once; other instances
 * see it within the window. That is acceptable for policy that changes a few
 * times a year, and it keeps the login path off the database.
 *
 * Secrets are encrypted with CryptoService on write and never returned by any
 * method except `getSecret`, which only server-side adapters call.
 */
@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);
  private snapshot: { at: number; rows: Map<string, Row> } | null = null;
  private inflight: Promise<Map<string, Row>> | null = null;

  constructor(
    private readonly store: PlatformStore,
    private readonly crypto: CryptoService,
  ) {}

  private async load(): Promise<Map<string, Row>> {
    const now = Date.now();
    if (this.snapshot && now - this.snapshot.at < CACHE_MS) return this.snapshot.rows;
    if (this.inflight) return this.inflight;

    this.inflight = this.store
      .tx(async (tx) => {
        const res = await tx.execute(sql`SELECT key, value, is_secret FROM platform_settings`);
        const rows = new Map<string, Row>();
        for (const r of res.rows as unknown as Array<{
          key: string;
          value: unknown;
          is_secret: boolean;
        }>) {
          rows.set(r.key, { value: r.value, isSecret: r.is_secret });
        }
        this.snapshot = { at: Date.now(), rows };
        return rows;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  invalidate(): void {
    this.snapshot = null;
  }

  /** Non-secret JSON value, or undefined. */
  async get<T>(key: string): Promise<T | undefined> {
    const row = (await this.load()).get(key);
    if (!row || row.isSecret) return undefined;
    return row.value as T;
  }

  async set(key: string, value: unknown, updatedBy: number | null): Promise<void> {
    await this.store.tx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${key}, ${JSON.stringify(value)}::jsonb, false, ${updatedBy}, now())
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, is_secret = false,
              updated_by = EXCLUDED.updated_by, updated_at = now()
      `);
    });
    this.invalidate();
  }

  /**
   * Shallow-merges `partial` into a JSON document in ONE statement
   * (`doc = doc || partial`), creating it if needed. For settings screens that
   * save only the keys they changed: two operators saving different keys at the
   * same moment both land, where a read-modify-write of the whole document would
   * let the second save silently put back what the first one changed.
   */
  async mergeDocument(
    key: string,
    partial: Record<string, unknown>,
    updatedBy: number | null,
  ): Promise<void> {
    await this.store.tx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${key}, ${JSON.stringify(partial)}::jsonb, false, ${updatedBy}, now())
        ON CONFLICT (key) DO UPDATE
          SET value = platform_settings.value || EXCLUDED.value,
              updated_by = EXCLUDED.updated_by, updated_at = now()
          WHERE NOT platform_settings.is_secret
      `);
    });
    this.invalidate();
  }

  /**
   * Read-modify-write of one JSON document under a row lock: the document is
   * read `FOR UPDATE`, handed to `mutate`, and written back before anyone else
   * can read it for their own edit. For edits that cannot be a shallow merge
   * (delete a nested field, change one page and leave its siblings), where
   * `mergeDocument` does not fit. Returns what `mutate` returned.
   */
  async updateDocument<T>(
    key: string,
    mutate: (current: Record<string, unknown>) => { next: Record<string, unknown>; result: T },
    updatedBy: number | null,
  ): Promise<T> {
    const result = await this.store.tx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${key}, '{}'::jsonb, false, ${updatedBy}, now())
        ON CONFLICT (key) DO NOTHING
      `);
      const res = await tx.execute(sql`
        SELECT value, is_secret FROM platform_settings WHERE key = ${key} FOR UPDATE
      `);
      const row = res.rows[0] as unknown as { value: unknown; is_secret: boolean } | undefined;
      if (!row || row.is_secret) throw new Error(`platform setting ${key} is not a plain document`);
      const current =
        row.value && typeof row.value === 'object' && !Array.isArray(row.value)
          ? (row.value as Record<string, unknown>)
          : {};
      const { next, result: out } = mutate(current);
      await tx.execute(sql`
        UPDATE platform_settings
        SET value = ${JSON.stringify(next)}::jsonb, updated_by = ${updatedBy}, updated_at = now()
        WHERE key = ${key}
      `);
      return out;
    });
    this.invalidate();
    return result;
  }

  /**
   * Merges `partial` into one object member of a JSON document in a single
   * statement (`doc[member] = doc[member] || partial`), creating the document
   * if needed. For writers that own just a few fields of a document someone else
   * also edits (the worker refreshing the OTP template status while an operator
   * saves the form): a read-modify-write of the whole document could lose
   * the other side's change.
   */
  async mergeMember(
    key: string,
    member: string,
    partial: Record<string, unknown>,
    updatedBy: number | null,
  ): Promise<void> {
    const json = JSON.stringify(partial);
    await this.store.tx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${key}, jsonb_build_object(${member}::text, ${json}::jsonb), false, ${updatedBy}, now())
        ON CONFLICT (key) DO UPDATE
          SET value = jsonb_set(
                platform_settings.value,
                ARRAY[${member}::text],
                COALESCE(platform_settings.value -> ${member}::text, '{}'::jsonb) || ${json}::jsonb
              ),
              updated_by = EXCLUDED.updated_by, updated_at = now()
          WHERE NOT platform_settings.is_secret
      `);
    });
    this.invalidate();
  }

  async setSecret(key: string, plaintext: string, updatedBy: number | null): Promise<void> {
    const envelope = this.crypto.encrypt(plaintext);
    await this.store.tx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${key}, ${JSON.stringify(envelope)}::jsonb, true, ${updatedBy}, now())
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, is_secret = true,
              updated_by = EXCLUDED.updated_by, updated_at = now()
      `);
    });
    this.invalidate();
  }

  /** Forgets a stored secret (the feature that needs it then reports "not configured"). */
  async clearSecret(key: string): Promise<void> {
    await this.store.tx(async (tx) => {
      await tx.execute(sql`DELETE FROM platform_settings WHERE key = ${key} AND is_secret = true`);
    });
    this.invalidate();
  }

  async hasSecret(key: string): Promise<boolean> {
    const row = (await this.load()).get(key);
    return Boolean(row?.isSecret && typeof row.value === 'string' && row.value.length > 0);
  }

  /** Plaintext secret for server-side adapters only. Never forward it to a response. */
  async getSecret(key: string): Promise<string | null> {
    const row = (await this.load()).get(key);
    if (!row?.isSecret || typeof row.value !== 'string') return null;
    try {
      return this.crypto.decrypt(row.value);
    } catch (err) {
      // A key rotated without re-encrypting stored values must not crash the
      // login path; the feature that needed the secret simply reports "not
      // configured".
      this.logger.error({ key, err }, 'could not decrypt platform secret');
      return null;
    }
  }
}
