import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  ERROR_CODES,
  NOTIFICATION_CATEGORY_KEYS,
  NOTIFICATION_EVENT_KEYS,
  defaultCategoryFlags,
  defaultEventFlags,
  normalizeFlags,
  type DeleteWorkspaceRequest,
  type NotificationPrefsResponse,
  type PreferencesResponse,
  type SaveNotificationPrefsRequest,
  type SavePreferencesRequest,
  type StoredNotificationPrefs,
  type UpdateWorkspaceSettingsRequest,
  type WorkspaceSettingsResponse,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { AuthAuditService, PasswordService, SessionService } from '../auth';
import { SettingsService } from '../platform-settings-branding-storage';
import { isKnownTimeZone, ownerMay, sameName } from './workspace-settings-rules';

interface OrgRow {
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  is_owner: boolean;
  has_owner: boolean;
  is_admin: boolean;
}

/** What the workspace stores about itself and its notification choices, inside `organizations.settings`. */
interface StoredOrgSettings {
  timezone?: string;
  currency?: string;
  notificationPrefs?: StoredNotificationPrefs & { slackWebhookEnc?: string };
}

const ONLY_OWNER = 'Only the workspace owner can edit these.';

/**
 * The customer Settings page's server side (WD-ASHELL-032..044). Everything is the caller's own workspace under row-level
 * security. Reads are open to any member; every write is the owner's (an administrator stands in when the workspace records
 * no owner, the same rule the account profile uses for the workspace timezone). Writes are audited, and the ones other
 * domains care about leave an outbox event in the same transaction.
 */
@Injectable()
export class WorkspaceSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuthAuditService,
    private readonly outbox: OutboxService,
    private readonly platform: SettingsService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  private actor(): { orgId: number; userId: number } {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.unauthenticated();
    return { orgId: ctx.orgId, userId: ctx.userId };
  }

  private async org(tx: Tx, orgId: number, userId: number): Promise<OrgRow> {
    const res = await tx.execute(sql`
      SELECT o.name, o.slug, o.settings,
             COALESCE((o.settings ->> 'ownerUserId') = u.uuid::text, false) AS is_owner,
             (o.settings ->> 'ownerUserId') IS NOT NULL AS has_owner,
             EXISTS (
               SELECT 1 FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
                WHERE ur.org_id = u.org_id AND ur.user_id = u.id AND r.system_key IN ('admin', 'workspace_admin')
             ) AS is_admin
        FROM organizations o JOIN users u ON u.org_id = o.id AND u.id = ${userId}
       WHERE o.id = ${orgId}
    `);
    const row = res.rows[0] as unknown as OrgRow | undefined;
    if (!row) throw AppError.unauthenticated();
    return row;
  }

  private mustOwn(row: OrgRow): void {
    if (!ownerMay(row)) throw new AppError(ERROR_CODES.FORBIDDEN, ONLY_OWNER, HttpStatus.FORBIDDEN);
  }

  // --- General (WD-ASHELL-033) -----------------------------------------------------------------------------------------

  async get(): Promise<WorkspaceSettingsResponse> {
    const { orgId, userId } = this.actor();
    const [row, currencies, general] = await Promise.all([
      this.db.txAs({ orgId, userId }, (tx) => this.org(tx, orgId, userId)),
      this.db.txAs({ orgId, userId }, async (tx) => {
        const res = await tx.execute(
          sql`SELECT code, name, symbol FROM currencies WHERE is_active ORDER BY code`,
        );
        return res.rows as unknown as WorkspaceSettingsResponse['currencies'];
      }),
      this.platform.values('general'),
    ]);
    const s = row.settings as StoredOrgSettings;
    return {
      name: row.name,
      slug: row.slug,
      timezone: s.timezone || 'UTC',
      currency: (s.currency || general.defaultCurrency || 'USD').toUpperCase(),
      isOwner: ownerMay(row),
      currencies,
    };
  }

  async update(body: UpdateWorkspaceSettingsRequest): Promise<WorkspaceSettingsResponse> {
    const { orgId, userId } = this.actor();
    // Blank values are ignored, never cleared (WaDesk).
    const name = body.name?.trim() || undefined;
    const timezone = body.timezone?.trim() || undefined;
    const currency = body.currency?.trim().toUpperCase() || undefined;
    if (timezone !== undefined && !isKnownTimeZone(timezone)) {
      throw AppError.validation('Unknown timezone', [
        { path: 'timezone', message: 'Not an IANA timezone.' },
      ]);
    }

    await this.db.txAs({ orgId, userId }, async (tx) => {
      const row = await this.org(tx, orgId, userId);
      this.mustOwn(row);
      if (currency !== undefined) {
        const known = await tx.execute(
          sql`SELECT 1 FROM currencies WHERE upper(code) = ${currency} AND is_active`,
        );
        if (known.rows.length === 0) {
          throw AppError.validation('Unknown currency', [
            { path: 'currency', message: 'The selected currency is invalid.' },
          ]);
        }
      }
      const patch: Record<string, string> = {};
      if (timezone !== undefined) patch.timezone = timezone;
      if (currency !== undefined) patch.currency = currency;
      await tx.execute(sql`
        UPDATE organizations
           SET name = COALESCE(${name ?? null}, name),
               settings = settings || ${JSON.stringify(patch)}::jsonb
         WHERE id = ${orgId}
      `);
      await this.audit.record(tx, {
        event: 'workspace.settings_updated',
        status: 'success',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
        payload: {
          fields: [name && 'name', timezone && 'timezone', currency && 'currency'].filter(Boolean),
        },
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'organizations',
        aggregateId: orgId,
        eventType: 'org.settings.updated',
        payload: { name: name ?? null, timezone: timezone ?? null, currency: currency ?? null },
      });
    });
    return this.get();
  }

  // --- Notifications (WD-ASHELL-038) -----------------------------------------------------------------------------------

  async notifications(): Promise<NotificationPrefsResponse> {
    const { orgId, userId } = this.actor();
    const [row, mail] = await Promise.all([
      this.db.txAs({ orgId, userId }, (tx) => this.org(tx, orgId, userId)),
      this.emailLive(),
    ]);
    const owner = ownerMay(row);
    const stored = (row.settings as StoredOrgSettings).notificationPrefs;
    let webhook: string | null = null;
    if (stored?.slackWebhookEnc) {
      try {
        webhook = this.crypto.decrypt(stored.slackWebhookEnc);
      } catch {
        webhook = null;
      }
    }
    return {
      events: NOTIFICATION_EVENT_KEYS.map((key) => ({
        key,
        ...(stored?.events?.[key] ?? defaultEventFlags(key)),
      })),
      categories: NOTIFICATION_CATEGORY_KEYS.map((key) => ({
        key,
        ...(stored?.categories?.[key] ?? defaultCategoryFlags()),
      })),
      slackWebhook: owner ? webhook : null,
      slackWebhookSet: webhook !== null,
      isOwner: owner,
      emailLive: mail,
    };
  }

  async saveNotifications(body: SaveNotificationPrefsRequest): Promise<NotificationPrefsResponse> {
    const { orgId, userId } = this.actor();
    await this.db.txAs({ orgId, userId }, async (tx) => {
      const row = await this.org(tx, orgId, userId);
      this.mustOwn(row);
      // Every event and category is written in full: a channel the form left out counts as off (WaDesk's hidden 0 inputs).
      const events = Object.fromEntries(
        NOTIFICATION_EVENT_KEYS.map((k) => [k, normalizeFlags(body.events?.[k])]),
      );
      const categories = Object.fromEntries(
        NOTIFICATION_CATEGORY_KEYS.map((k) => [k, normalizeFlags(body.categories?.[k])]),
      );
      const prior = (row.settings as StoredOrgSettings).notificationPrefs;
      const url = body.slackWebhook?.trim();
      // Blank clears the URL; leaving the field out of the request keeps what is there.
      const slackWebhookEnc =
        url === undefined
          ? prior?.slackWebhookEnc
          : url === ''
            ? undefined
            : this.crypto.encrypt(url);
      const doc = { events, categories, ...(slackWebhookEnc ? { slackWebhookEnc } : {}) };
      await tx.execute(sql`
        UPDATE organizations
           SET settings = settings || jsonb_build_object('notificationPrefs', ${JSON.stringify(doc)}::jsonb)
         WHERE id = ${orgId}
      `);
      await this.audit.record(tx, {
        event: 'workspace.notification_prefs_saved',
        status: 'success',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
        payload: { slackWebhookSet: Boolean(slackWebhookEnc) },
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'organizations',
        aggregateId: orgId,
        eventType: 'org.notification_prefs.changed',
        payload: { events, categories, slackWebhookSet: Boolean(slackWebhookEnc) },
      });
    });
    return this.notifications();
  }

  /** WaDesk's "Channel status" note: email is live only when the platform has SMTP configured. */
  private async emailLive(): Promise<boolean> {
    if (!(await this.platform.isSaved('mail'))) return false;
    const v = await this.platform.values('mail');
    return v.mailer === 'smtp' && Boolean(v.host);
  }

  // --- Delete workspace (WD-ASHELL-044) --------------------------------------------------------------------------------

  /**
   * Checks in WaDesk's order: owner, validation (the schema), password, exact name. The workspace is marked deleted, which
   * stops every sign-in, refresh and public link at once (they all require `status = 'active'`), and every member's live
   * session ends. WaDesk soft-deleted and left other members signed in.
   */
  async deleteWorkspace(body: DeleteWorkspaceRequest): Promise<void> {
    const { orgId, userId } = this.actor();
    const revoked = await this.db.txAs({ orgId, userId }, async (tx) => {
      const row = await this.org(tx, orgId, userId);
      if (!ownerMay(row)) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          'Only the workspace owner can delete the workspace.',
          HttpStatus.FORBIDDEN,
        );
      }
      const pw = await tx.execute(
        sql`SELECT password_hash FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
      );
      const hash = (pw.rows[0] as { password_hash: string | null } | undefined)?.password_hash;
      if (!(await this.passwords.verifyOrDummy(hash, body.password))) {
        throw new AppError(
          ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG,
          'Wrong password.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'password', message: 'Wrong password.' }],
        );
      }
      if (!sameName(body.confirmName, row.name)) {
        throw AppError.validation('Workspace name does not match.', [
          { path: 'confirmName', message: 'Workspace name does not match.' },
        ]);
      }
      await tx.execute(sql`UPDATE organizations SET status = 'deleted' WHERE id = ${orgId}`);
      const ended = await tx.execute(sql`
        UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'workspace_deleted'
         WHERE org_id = ${orgId} AND revoked_at IS NULL
        RETURNING uuid
      `);
      await this.audit.record(tx, {
        event: 'workspace.deleted',
        status: 'info',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
        payload: { name: row.name },
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'organizations',
        aggregateId: orgId,
        eventType: 'org.deleted',
        payload: { name: row.name, slug: row.slug },
      });
      return (ended.rows as unknown as Array<{ uuid: string }>).map((r) => r.uuid);
    });
    // The access tokens of those sessions stop working at once, not at their expiry.
    await Promise.all(revoked.map((sid) => this.sessions.tombstone(sid)));
  }

  // --- Personal preference (WD-ASHELL-035) -----------------------------------------------------------------------------

  async preferences(): Promise<PreferencesResponse> {
    const { orgId, userId } = this.actor();
    const res = await this.db.txAs({ orgId, userId }, (tx) =>
      tx.execute(
        sql`SELECT auto_ai_summarize_enabled AS v FROM user_settings WHERE org_id = ${orgId} AND user_id = ${userId}`,
      ),
    );
    return { autoAiSummarize: (res.rows[0] as { v: boolean } | undefined)?.v === true };
  }

  async savePreferences(body: SavePreferencesRequest): Promise<PreferencesResponse> {
    const { orgId, userId } = this.actor();
    await this.db.txAs({ orgId, userId }, async (tx) => {
      await tx.execute(sql`
        INSERT INTO user_settings (org_id, user_id, auto_ai_summarize_enabled)
        VALUES (${orgId}, ${userId}, ${body.autoAiSummarize})
        ON CONFLICT (org_id, user_id) DO UPDATE SET auto_ai_summarize_enabled = EXCLUDED.auto_ai_summarize_enabled
      `);
      await this.audit.record(tx, {
        event: 'user.preferences_updated',
        status: 'success',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
        payload: { autoAiSummarize: body.autoAiSummarize },
      });
    });
    return this.preferences();
  }
}
