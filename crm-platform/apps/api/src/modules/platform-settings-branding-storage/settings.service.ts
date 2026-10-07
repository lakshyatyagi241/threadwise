import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  GOOGLE_CALENDAR_CALLBACK_PATH,
  SET_GROUPS,
  SET_GROUP_SCHEMAS,
  SET_SECRET_FIELDS,
  SET_TESTABLE_GROUPS,
  type SetExportResponse,
  type SetGroup,
  type SetGroupResponse,
  type SetGroupValues,
  type SetHubResponse,
  type SetPatchRequest,
  type SetTestableGroup,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { googleCalendarEnv } from '../../config/domains/appointments-booking.env';
import type { Env } from '../../config/env.schema';
import type { Tx } from '@crm/db';
import { AuthAuditService, PlatformSettingsService } from '../auth';

/** Where a group's document and its secrets live in the platform store (see port-map). */
export const docKey = (g: SetGroup) => `set.${g}`;
export const secretKey = (g: SetGroup, field: string) => `set.${g}.${field}`;
const testKey = (g: SetGroup) => `set.${g}._test`;
/** The Team Inbox app's Web Push key pair (TW-SET-038): generated, never typed in. */
export const VAPID_PUBLIC_KEY = 'set.tiPwa.vapidPublic';
export const VAPID_PRIVATE_KEY = 'set.tiPwa.vapidPrivate';

/** Fields an export never prints even though they are not secrets (they identify the account). */
const EXPORT_MASKED: Partial<Record<SetGroup, readonly string[]>> = {
  storage: ['accessKeyId'],
  mail: ['username'],
  analytics: ['posthogKey', 'mixpanelToken'],
};

/** A stored value that says something: not blank, not an empty list, not an object of blanks. */
function hasValue(v: unknown): boolean {
  if (v === '' || v === null || v === undefined || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v as object).some(hasValue);
  return true;
}

interface Doc {
  _rv?: number;
  _at?: string;
  [k: string]: unknown;
}

/**
 * Typed read and versioned write of the platform settings groups (TW-SET-001, 002).
 *
 * A group is one JSON document with an `_rv` counter. A write compares the caller's `rowVersion` with it
 * inside a locked transaction (409 on mismatch, never a silent last-write-wins), merges the patch over the
 * current values, re-validates the whole group, writes the secrets, and records the audit event with the
 * changed FIELD NAMES only, all in that one transaction.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly store: PlatformSettingsService,
    private readonly audit: AuthAuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // --- reads ----------------------------------------------------------------------------------

  /** What a never-saved group shows: the schema defaults, with `.env` filling the few that exist there. */
  defaults<G extends SetGroup>(group: G): SetGroupValues<G> {
    const base: Record<string, unknown> = {};
    if (group === 'general') {
      base.appName = this.config.get('APP_NAME', { infer: true });
      // Reference seeded the footer with the brand name at install time; a never-saved group shows the same.
      base.platformFooter = `Sent via ${base.appName}`.slice(0, 60);
    }
    if (group === 'mail') {
      base.host = this.config.get('SMTP_HOST', { infer: true });
      base.port = this.config.get('SMTP_PORT', { infer: true });
      base.username = this.config.get('SMTP_USER', { infer: true }) ?? '';
      base.fromAddress = this.config.get('SMTP_FROM', { infer: true });
      base.encryption = this.config.get('SMTP_SECURE', { infer: true }) ? 'ssl' : 'tls';
    }
    const parsed = SET_GROUP_SCHEMAS[group].safeParse(base);
    return (parsed.success ? parsed.data : SET_GROUP_SCHEMAS[group].parse({})) as SetGroupValues<G>;
  }

  private async raw(group: SetGroup): Promise<Doc | undefined> {
    return this.store.get<Doc>(docKey(group));
  }

  async isSaved(group: SetGroup): Promise<boolean> {
    return (await this.raw(group)) !== undefined;
  }

  /** Current typed values of a group (saved document over defaults). Consumers read through this. */
  async values<G extends SetGroup>(group: G): Promise<SetGroupValues<G>> {
    const doc = await this.raw(group);
    if (!doc) return this.defaults(group);
    const { _rv, _at, ...fields } = doc;
    void _rv;
    void _at;
    const parsed = SET_GROUP_SCHEMAS[group].safeParse(fields);
    // A document that no longer fits the schema (a field tightened later) must not take the app down.
    return (parsed.success ? parsed.data : this.defaults(group)) as SetGroupValues<G>;
  }

  /** Plaintext of one secret for server-side adapters only. Never forward it to a response. */
  secret(group: SetGroup, field: string): Promise<string | null> {
    return this.store.getSecret(secretKey(group, field));
  }

  async read(group: SetGroup): Promise<SetGroupResponse> {
    // The settings page must see what a save elsewhere just wrote, or its next PATCH carries a stale
    // rowVersion and fails with a conflict nobody caused: skip the 5 s snapshot for this read.
    this.store.invalidate();
    const doc = await this.raw(group);
    const secrets: SetGroupResponse['secrets'] = {};
    for (const f of SET_SECRET_FIELDS[group] as readonly string[]) {
      secrets[f] = { isSet: await this.store.hasSecret(secretKey(group, f)) };
    }
    const test = await this.store.get<{ ok: boolean; at: string }>(testKey(group));
    let extra: Record<string, unknown> | undefined;
    if (group === 'tiPwa') {
      extra = {
        vapidPublic: (await this.store.get<string>(VAPID_PUBLIC_KEY)) ?? '',
        pushReady:
          (await this.store.get<string>(VAPID_PUBLIC_KEY)) !== undefined &&
          (await this.store.hasSecret(VAPID_PRIVATE_KEY)),
      };
    } else if (group === 'googleCalendar') {
      // The address to register on the Google OAuth client: what is saved, else the environment's, else the API's own callback.
      const saved = (await this.values('googleCalendar')).redirectUri;
      const appUrl = this.config.get('APP_URL', { infer: true }).replace(/\/$/, '');
      extra = {
        redirectUri:
          saved ||
          googleCalendarEnv().GOOGLE_CALENDAR_REDIRECT_URI ||
          `${appUrl}${GOOGLE_CALENDAR_CALLBACK_PATH}`,
      };
    }
    return {
      group,
      values: (await this.values(group)) as Record<string, unknown>,
      secrets,
      rowVersion: doc?._rv ?? 0,
      updatedAt: doc?._at ?? null,
      test: test ? { ok: test.ok, at: test.at } : null,
      ...(extra ? { extra } : {}),
    };
  }

  // --- write ----------------------------------------------------------------------------------

  async patch(
    group: SetGroup,
    body: SetPatchRequest,
    operatorId: number,
  ): Promise<SetGroupResponse> {
    const schema = SET_GROUP_SCHEMAS[group];
    const secretFields = SET_SECRET_FIELDS[group] as readonly string[];
    const key = docKey(group);

    await this.store.inTx(async (tx) => {
      // Lock the row for the whole transaction so two operators cannot both pass the version check.
      const found = await tx.execute(
        sql`SELECT value FROM platform_settings WHERE key = ${key} FOR UPDATE`,
      );
      const current = (found.rows[0] as { value: Doc } | undefined)?.value;
      const currentVersion = current?._rv ?? 0;
      if (currentVersion !== body.rowVersion) throw AppError.rowVersionConflict('Settings');

      let before: Record<string, unknown>;
      if (current) {
        const { _rv, _at, ...fields } = current;
        void _rv;
        void _at;
        const p = schema.safeParse(fields);
        before = (p.success ? p.data : this.defaults(group)) as Record<string, unknown>;
      } else {
        before = this.defaults(group) as Record<string, unknown>;
      }
      const merged = schema.safeParse({ ...before, ...body.values });
      if (!merged.success) {
        throw AppError.validation(
          'Settings are not valid',
          merged.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      const after = merged.data as Record<string, unknown>;
      const changed = Object.keys(after).filter(
        (k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]),
      );

      // Blank keeps the stored secret; null removes it; anything else replaces it.
      const secretWrites = Object.entries(body.secrets).filter(
        ([f, v]) => secretFields.includes(f) && v !== '',
      );
      if (!changed.length && !secretWrites.length && current) return;

      const doc: Doc = { ...after, _rv: currentVersion + 1, _at: new Date().toISOString() };
      const json = JSON.stringify(doc);
      if (current) {
        await tx.execute(sql`
          UPDATE platform_settings
             SET value = ${json}::jsonb, updated_by = ${operatorId}, updated_at = now()
           WHERE key = ${key}`);
      } else {
        const ins = await tx.execute(sql`
          INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
          VALUES (${key}, ${json}::jsonb, false, ${operatorId}, now())
          ON CONFLICT (key) DO NOTHING
          RETURNING key`);
        // Another first save won the race between our read and this insert.
        if (ins.rows.length === 0) throw AppError.rowVersionConflict('Settings');
      }

      const touched: string[] = [];
      for (const [field, value] of secretWrites) {
        const sk = secretKey(group, field);
        if (value === null) {
          await tx.execute(
            sql`DELETE FROM platform_settings WHERE key = ${sk} AND is_secret = true`,
          );
        } else {
          const sealed = JSON.stringify(this.store.seal(value));
          await tx.execute(sql`
            INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
            VALUES (${sk}, ${sealed}::jsonb, true, ${operatorId}, now())
            ON CONFLICT (key) DO UPDATE
              SET value = EXCLUDED.value, is_secret = true,
                  updated_by = EXCLUDED.updated_by, updated_at = now()`);
        }
        touched.push(field);
      }

      await this.audit.record(tx, {
        event: `platform.settings.${group}_updated`,
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { fields: [...changed, ...touched], rowVersion: currentVersion + 1 },
      });
    });

    return this.read(group);
  }

  /**
   * A server-side change to one group that does not come from a form (an uploaded brand asset): lock the document, apply
   * `change` to its current values, re-validate, bump `_rv` and audit, in one transaction with whatever `inTx` writes.
   */
  async mutate(
    group: SetGroup,
    operatorId: number,
    change: (values: Record<string, unknown>) => Record<string, unknown>,
    inTx?: (tx: Tx) => Promise<void>,
  ): Promise<void> {
    const schema = SET_GROUP_SCHEMAS[group];
    const key = docKey(group);
    await this.store.inTx(async (tx) => {
      const found = await tx.execute(
        sql`SELECT value FROM platform_settings WHERE key = ${key} FOR UPDATE`,
      );
      const current = (found.rows[0] as { value: Doc } | undefined)?.value;
      const before = (current ? { ...current } : this.defaults(group)) as Record<string, unknown>;
      delete before._rv;
      delete before._at;
      const parsedBefore = schema.safeParse(before);
      const base = (parsedBefore.success ? parsedBefore.data : this.defaults(group)) as Record<
        string,
        unknown
      >;
      const merged = schema.safeParse(change({ ...base }));
      if (!merged.success) {
        throw AppError.validation(
          'Settings are not valid',
          merged.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      const after = merged.data as Record<string, unknown>;
      const changed = Object.keys(after).filter(
        (k) => JSON.stringify(after[k]) !== JSON.stringify(base[k]),
      );
      const version = (current?._rv ?? 0) + 1;
      const json = JSON.stringify({ ...after, _rv: version, _at: new Date().toISOString() });
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${key}, ${json}::jsonb, false, ${operatorId}, now())
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`);
      if (inTx) await inTx(tx);
      await this.audit.record(tx, {
        event: `platform.settings.${group}_updated`,
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { fields: changed, rowVersion: version },
      });
    });
  }

  /** Stores the outcome of a connection test and audits it (the hub's "needs test" reads it). */
  async recordTest(
    group: SetTestableGroup,
    ok: boolean,
    message: string,
    operatorId: number,
  ): Promise<void> {
    await this.store.inTx(async (tx) => {
      if (ok) {
        const json = JSON.stringify({ ok, at: new Date().toISOString() });
        await tx.execute(sql`
          INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
          VALUES (${testKey(group)}, ${json}::jsonb, false, ${operatorId}, now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
      }
      await this.audit.record(tx, {
        event: `platform.settings.${group}_test`,
        status: ok ? 'success' : 'failure',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { ok, message: message.slice(0, 200) },
      });
    });
  }

  // --- hub and export (TW-SET-003, 004) ----------------------------------------------------------

  private async rows() {
    return this.store.inTx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT key, value, is_secret, updated_at
          FROM platform_settings WHERE key LIKE 'set.%' AND key NOT LIKE 'set.asset.%' ORDER BY key`);
      return res.rows as unknown as Array<{
        key: string;
        value: unknown;
        is_secret: boolean;
        updated_at: Date | string;
      }>;
    });
  }

  private needsTest(group: SetGroup, v: Record<string, unknown>, tested: boolean): boolean {
    if (!(SET_TESTABLE_GROUPS as readonly string[]).includes(group)) return false;
    const configured =
      group === 'mail' ? Boolean(v.host) && v.mailer === 'smtp' : v.enabled === true;
    return configured && !tested;
  }

  async hub(): Promise<SetHubResponse> {
    this.store.invalidate();
    const rows = await this.rows();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let last: Date | null = null;
    for (const r of rows) {
      const d = new Date(r.updated_at);
      if (!last || d > last) last = d;
    }
    const groups = await Promise.all(
      SET_GROUPS.map(async (group) => {
        const doc = byKey.get(docKey(group))?.value as Doc | undefined;
        const tested =
          (byKey.get(testKey(group))?.value as { ok?: boolean } | undefined)?.ok === true;
        const { _rv, _at, ...fields } = doc ?? {};
        void _rv;
        void _at;
        return {
          group,
          saved: doc !== undefined,
          filled: Object.values(fields).some(hasValue),
          updatedAt: doc?._at ?? null,
          needsTest: this.needsTest(
            group,
            (await this.values(group)) as Record<string, unknown>,
            tested,
          ),
        };
      }),
    );
    // "Healthy" = saved and holding at least one non-empty value (Reference: rows with a non-empty value).
    const healthy = groups.filter((g) => g.saved && g.filled).length;
    return {
      kpis: {
        savedGroups: groups.filter((g) => g.saved).length,
        healthyGroups: healthy,
        totalGroups: SET_GROUPS.length,
        needsTest: groups.filter((g) => g.needsTest).map((g) => g.group),
        secretFields: rows.filter((r) => r.is_secret).length,
        lastUpdatedAt: last ? last.toISOString() : null,
      },
      groups,
    };
  }

  /** Every saved value, with secrets and account identifiers replaced; safe to attach to a ticket. */
  async export(operatorId: number): Promise<SetExportResponse> {
    const rows = await this.rows();
    const settings = rows
      .filter((r) => !r.key.includes('._test'))
      .map((r) => {
        if (r.is_secret) return { key: r.key, value: '[REDACTED]' as unknown, secret: true };
        // A lone value (the public push key) is exported as it is; a group document loses its bookkeeping.
        if (typeof r.value !== 'object' || r.value === null || Array.isArray(r.value)) {
          return { key: r.key, value: r.value, secret: false };
        }
        const group = r.key.split('.')[1] as SetGroup;
        const doc = { ...(r.value as Doc) };
        delete doc._rv;
        delete doc._at;
        for (const f of EXPORT_MASKED[group] ?? []) if (doc[f]) doc[f] = '[REDACTED]';
        return { key: r.key, value: doc as unknown, secret: false };
      });
    await this.store.inTx(async (tx) => {
      await this.audit.record(tx, {
        event: 'platform.settings.exported',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { rows: settings.length },
      });
    });
    const general = await this.values('general');
    return {
      app: general.appName,
      exportedAt: new Date().toISOString(),
      note: 'Secret values and account identifiers are replaced with [REDACTED].',
      settings,
    };
  }
}
