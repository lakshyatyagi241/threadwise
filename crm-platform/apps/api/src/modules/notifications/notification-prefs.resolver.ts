import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  NOTIFICATION_TYPE_PREF_KEY,
  effectiveEventFlags,
  type NotificationPrefType,
  type StoredNotificationPrefs,
} from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { cacheMetrics } from '@crm/observability';

const cache = cacheMetrics('notification_prefs');

/**
 * Whether the workspace owner's notification toggles (Settings, Notifications; stored in `organizations.settings.notificationPrefs`)
 * allow a type to reach the in-app bell. The same default table the settings page shows decides an unset toggle
 * (`effectiveEventFlags`), so the screen and the effect cannot disagree.
 *
 * Decision D3: only the types in `NOTIFICATION_TYPE_PREF_KEY` are gated (the conversation types, and from phase 2 the device, broadcast,
 * campaign, team chat mention and wallet alert types); every other type is delivered as before. The owner turning the in-app toggle off
 * stops both the row and the live push for that type, unless a person chose otherwise for themselves.
 */
@Injectable()
export class NotificationPrefsResolver {
  /** A few seconds of memory per workspace: a busy inbox asks once per event, and the toggles change a few times a year. */
  private readonly cache = new Map<
    number,
    { at: number; prefs: StoredNotificationPrefs | undefined }
  >();
  ttlMs = 5_000;

  constructor(private readonly db: DatabaseService) {}

  /** Forget what was read (tests, and a caller that just saved the toggles in this process). */
  clear(): void {
    this.cache.clear();
  }

  /** Forget one workspace (a screen that must show what is in force right now, not what was true a few seconds ago). */
  forget(orgId: number): void {
    this.cache.delete(orgId);
  }

  /** The owner's stored document for this workspace (undefined when they never saved the page). */
  async stored(orgId: number): Promise<StoredNotificationPrefs | undefined> {
    const hit = this.cache.get(orgId);
    if (hit && Date.now() - hit.at < this.ttlMs) {
      cache.hit();
      return hit.prefs;
    }
    cache.miss();
    const prefs = await this.load(orgId);
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(orgId, { at: Date.now(), prefs });
    return prefs;
  }

  private async load(orgId: number): Promise<StoredNotificationPrefs | undefined> {
    const res = await this.db.txAs({ orgId, userId: null }, (tx) =>
      tx.execute(
        sql`SELECT settings -> 'notificationPrefs' AS prefs FROM organizations WHERE id = ${orgId}`,
      ),
    );
    const row = res.rows[0] as { prefs: StoredNotificationPrefs | null } | undefined;
    return row?.prefs ?? undefined;
  }

  /**
   * True when the OWNER's in-app toggle allows this type (always true for a type no toggle governs). A person's own preference is
   * layered on top by `resolveNotificationChannels`: theirs wins over this one.
   */
  async inappAllowed(orgId: number, type: NotificationPrefType): Promise<boolean> {
    const key = NOTIFICATION_TYPE_PREF_KEY[type];
    if (!key) return true;
    return effectiveEventFlags(await this.stored(orgId), key).inapp;
  }
}
