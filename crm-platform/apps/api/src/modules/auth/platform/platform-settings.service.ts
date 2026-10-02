import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PlatformStore } from './platform-store';

interface Row {
  value: unknown;
  isSecret: boolean;
}

const CACHE_MS = 5_000;

/**
 * Typed access to `platform_settings` (WD-SET's store, built early because the
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
        const res = await tx.execute(sql`SELECT key, value, is_secret FROM platform_settings WHERE key NOT LIKE 'set.asset.%'`);
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

  /**
   * One transaction on the platform store, for a writer that must read, compare and write several keys
   * (and record its audit event) atomically: the platform-settings domain (WD-SET) edits a whole group at
   * once under a version check. The snapshot is dropped afterwards so this process reads the new values.
   */
  async inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.store.tx(fn);
    } finally {
      this.invalidate();
    }
  }

  /** Encrypts for storage as a secret row written inside `inTx`. */
  seal(plaintext: string): string {
    return this.crypto.encrypt(plaintext);
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
