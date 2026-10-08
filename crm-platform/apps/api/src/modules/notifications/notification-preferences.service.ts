import { Injectable } from '@nestjs/common';
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_PREF_TYPES,
  NOTIFICATION_TYPE_PLAN_FEATURE,
  resolveNotificationChannels,
  type NotificationPreferenceItem,
  type NotificationPreferencesResponse,
  type StoredUserPref,
  type UpdateNotificationPreferencesRequest,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { NotificationPrefsResolver } from './notification-prefs.resolver';
import { NotificationsRepository } from './notifications.repository';

const MODULE = 'notifications';
const CHANNELS = ['bell', 'toast', 'sound', 'push'] as const;
const NONE: StoredUserPref = { bell: null, toast: null, sound: null, push: null };

/**
 * The caller's own notification preferences (BL-096 phase 2): which notification types reach their bell, pop a toast, play the ping and send a browser (Web Push) notification.
 * Staff only and pinned to the caller, like the rest of the bell, so there is no permission key and nobody can read or change someone
 * else's. The stored document is sparse (a channel left unset inherits the owner's toggle, then the catalogue default), and the
 * producers read it through `NotificationsRepository.channelsFor`, so what this screen shows is exactly what the producers do.
 *
 * A type that needs a plan feature (`NOTIFICATION_TYPE_PLAN_FEATURE`: the WhatsApp Groups ones) is left out of the list when the
 * workspace's plan lacks it, so a person never sees a switch for something that cannot reach them. The producers apply the same gate.
 *
 * Changing a preference is audited (who, which type and channel, from what to what) in the same transaction as the write. Sending the
 * same update twice changes nothing and audits nothing.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: NotificationsRepository,
    private readonly workspace: NotificationPrefsResolver,
    private readonly audit: AuditService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  private caller(): { orgId: number; userId: number } {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.forbidden('notifications');
    return { orgId: ctx.orgId, userId: ctx.userId };
  }

  async get(): Promise<NotificationPreferencesResponse> {
    const { orgId, userId } = this.caller();
    const stored = await this.db.tx((tx) => this.repo.userPrefsOf(tx, orgId, userId));
    return this.build(orgId, stored);
  }

  async update(
    input: UpdateNotificationPreferencesRequest,
  ): Promise<NotificationPreferencesResponse> {
    const { orgId, userId } = this.caller();
    const stored = await this.db.tx(async (tx) => {
      const before = await this.repo.userPrefsOf(tx, orgId, userId);
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      for (const item of input.items) {
        const old = before.get(item.type) ?? NONE;
        const patch = {
          ...(item.bell !== undefined ? { bell: item.bell } : {}),
          ...(item.toast !== undefined ? { toast: item.toast } : {}),
          ...(item.sound !== undefined ? { sound: item.sound } : {}),
          ...(item.push !== undefined ? { push: item.push } : {}),
        };
        for (const channel of CHANNELS) {
          const next = patch[channel];
          if (next !== undefined && next !== old[channel]) {
            delta[`${item.type}.${channel}`] = { old: old[channel], new: next };
          }
        }
        if (Object.keys(patch).length > 0) {
          await this.repo.applyUserPref(tx, orgId, userId, item.type, patch);
        }
      }
      if (Object.keys(delta).length > 0) {
        await this.audit.record(tx, { module: MODULE, recordId: userId, action: 'update', delta });
      }
      return this.repo.userPrefsOf(tx, orgId, userId);
    });
    return this.build(orgId, stored);
  }

  private async build(
    orgId: number,
    stored: Map<string, StoredUserPref>,
  ): Promise<NotificationPreferencesResponse> {
    const items: NotificationPreferenceItem[] = [];
    // A person who just asked the owner to change a toggle expects to see it: this read is rare, so it skips the producers' short cache.
    this.workspace.forget(orgId);
    const offered = new Map<string, boolean>();
    for (const type of NOTIFICATION_PREF_TYPES) {
      const feature = NOTIFICATION_TYPE_PLAN_FEATURE[type];
      if (feature) {
        if (!offered.has(feature)) {
          offered.set(feature, await this.entitlements.featureEnabled(orgId, feature));
        }
        if (!offered.get(feature)) continue;
      }
      const own = stored.get(type) ?? NONE;
      const workspaceInapp = await this.workspace.inappAllowed(orgId, type);
      const base = NOTIFICATION_CATALOG[type];
      items.push({
        type,
        group: base.group,
        ...resolveNotificationChannels(type, own, workspaceInapp),
        defaults: { bell: true, toast: base.toast, sound: base.sound, push: base.push },
        overrides: { bell: own.bell, toast: own.toast, sound: own.sound, push: own.push },
        workspaceInapp,
      });
    }
    return { items };
  }
}
