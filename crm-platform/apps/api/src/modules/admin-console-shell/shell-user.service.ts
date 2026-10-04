import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  groupAnnouncements,
  parseShellMode,
  resolveQuickAccess,
  sanitizeQuickAccess,
  type AnnouncementRow,
  type AnnouncementsResponse,
  type ClearNotificationsResponse,
  type QuickAccessResponse,
  type ShellConfigResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService } from '../auth';
import { SettingsService } from '../platform-settings-branding-storage';
import { NavLayoutService } from './nav-layout.service';
import { WorkspaceSettingsService } from './workspace-settings.service';

/**
 * What the customer shell asks for on every page: the navigation mode and rail colours (WD-ASHELL-011, 012), the top bar's
 * entries (009), whether the tour should run (023), the announcement bars (026) and the person's quick access (022).
 * Platform-level values come through the platform-settings barrel; the person's own row is `user_settings` under RLS.
 */
@Injectable()
export class ShellUserService {
  constructor(
    private readonly db: DatabaseService,
    private readonly platform: SettingsService,
    private readonly layout: NavLayoutService,
    private readonly workspace: WorkspaceSettingsService,
    private readonly audit: AuthAuditService,
  ) {}

  private actor(): { orgId: number; userId: number } {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.unauthenticated();
    return { orgId: ctx.orgId, userId: ctx.userId };
  }

  private async myRow(): Promise<{ quick_access: unknown; has_seen_intro: boolean }> {
    const { orgId, userId } = this.actor();
    const res = await this.db.txAs({ orgId, userId }, (tx) =>
      tx.execute(
        sql`SELECT quick_access, has_seen_intro FROM user_settings WHERE org_id = ${orgId} AND user_id = ${userId}`,
      ),
    );
    return (
      (res.rows[0] as { quick_access: unknown; has_seen_intro: boolean } | undefined) ?? {
        quick_access: null,
        has_seen_intro: false,
      }
    );
  }

  async config(): Promise<ShellConfigResponse> {
    const [branding, nav, mine, brand] = await Promise.all([
      this.platform.values('branding'),
      this.layout.get(),
      this.myRow(),
      this.workspace.brand(),
    ]);
    return {
      mode: parseShellMode(branding.dashboardLayout),
      rail: {
        color: branding.sidebarColor || null,
        textColor: branding.sidebarTextColor || null,
        accentColor: branding.sidebarAccentColor || null,
      },
      bar: nav.bar,
      more: nav.more,
      tour: { run: !mine.has_seen_intro },
      brand,
    };
  }

  /**
   * The bell's "Clear all" (WD-ASHELL-018): deletes the caller's own notifications. The notifications module serves the feed and
   * mark-read but has no delete, and WaDesk's bell has this button, so the delete is here; it touches only (org, caller).
   */
  async clearNotifications(): Promise<ClearNotificationsResponse> {
    const { orgId, userId } = this.actor();
    const cleared = await this.db.txAs({ orgId, userId }, async (tx) => {
      const res = await tx.execute(sql`
        DELETE FROM inbox_notifications WHERE org_id = ${orgId} AND user_id = ${userId} RETURNING 1
      `);
      await this.audit.record(tx, {
        event: 'notifications.cleared',
        status: 'info',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
        payload: { count: res.rows.length },
      });
      return res.rows.length;
    });
    return { cleared };
  }

  /** The first call of the tour's lifetime flips the flag; later calls change nothing. */
  async tourSeen(): Promise<{ ok: true }> {
    const { orgId, userId } = this.actor();
    await this.db.txAs({ orgId, userId }, (tx) =>
      tx.execute(sql`
        INSERT INTO user_settings (org_id, user_id, has_seen_intro) VALUES (${orgId}, ${userId}, true)
        ON CONFLICT (org_id, user_id) DO UPDATE SET has_seen_intro = true
      `),
    );
    return { ok: true };
  }

  /** One indexed read per page load; WaDesk cached it for a minute, which would hide an edit from the next request. */
  async announcements(): Promise<AnnouncementsResponse> {
    const { orgId, userId } = this.actor();
    const res = await this.db.txAs({ orgId, userId }, (tx) =>
      tx.execute(sql`
        SELECT uuid::text AS uuid, text, link_url, link_label, tone, dismissible
          FROM announcements
         WHERE is_active
           AND (starts_at IS NULL OR starts_at <= now())
           AND (expires_at IS NULL OR expires_at >= now())
         ORDER BY sort_order, id
      `),
    );
    return { bars: groupAnnouncements(res.rows as unknown as AnnouncementRow[]) };
  }

  async quickAccess(): Promise<QuickAccessResponse> {
    return { tiles: resolveQuickAccess((await this.myRow()).quick_access) };
  }

  async saveQuickAccess(items: unknown): Promise<QuickAccessResponse> {
    const { orgId, userId } = this.actor();
    const clean = sanitizeQuickAccess(items);
    await this.db.txAs({ orgId, userId }, (tx) =>
      tx.execute(sql`
        INSERT INTO user_settings (org_id, user_id, quick_access)
        VALUES (${orgId}, ${userId}, ${JSON.stringify(clean)}::jsonb)
        ON CONFLICT (org_id, user_id) DO UPDATE SET quick_access = EXCLUDED.quick_access
      `),
    );
    return { tiles: resolveQuickAccess(clean) };
  }
}
