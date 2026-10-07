import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  NOTIFICATION_TYPE_PREF_KEY,
  effectiveEventFlags,
  type NotificationType,
  type StoredNotificationPrefs,
} from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';

/**
 * Whether the workspace owner's notification toggles (Settings, Notifications; stored in `organizations.settings.notificationPrefs`)
 * allow a type to reach the in-app bell. The same default table the settings page shows decides an unset toggle
 * (`effectiveEventFlags`), so the screen and the effect cannot disagree.
 *
 * Decision D3: only the conversation types are gated (`NOTIFICATION_TYPE_PREF_KEY`); every other type is delivered as before. A person
 * who turns the in-app toggle off stops both the row and the live push for that type.
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

  /** The owner's stored document for this workspace (undefined when they never saved the page). */
  async stored(orgId: number): Promise<StoredNotificationPrefs | undefined> {
    const hit = this.cache.get(orgId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.prefs;
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

  /** True when the in-app channel is on for this type (always true for a type no toggle governs). */
  async inappAllowed(orgId: number, type: NotificationType): Promise<boolean> {
    const key = NOTIFICATION_TYPE_PREF_KEY[type];
    if (!key) return true;
    return effectiveEventFlags(await this.stored(orgId), key).inapp;
  }
}
