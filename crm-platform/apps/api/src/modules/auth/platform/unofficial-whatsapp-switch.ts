import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { UnofficialWhatsappGate } from '../unofficial-whatsapp.port';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformStore } from './platform-store';

const ALLOW_CACHE_MS = 5_000;

/** The one `platform_settings` key behind the switch. A plain JSON boolean; a missing row is off. */
export const UNOFFICIAL_WHATSAPP_KEY = 'wa.unofficial.enabled';

/**
 * Whether the unofficial WhatsApp engine may be used (owner decisions 2026-10-05 and 2026-10-06: only the official Cloud API / BSP
 * route is supported by default; the Baileys engine stays in the code, OFF for everyone, and only a platform super admin can allow it).
 *
 * Two levels: the platform switch (`wa.unofficial.enabled`, the global kill-switch, `isEnabled`) and the per-workspace allow-list
 * (`unofficial_whatsapp_workspaces`). A workspace has access only when both hold (`isEnabledFor`). Platform-owned workspaces get no
 * special treatment. Reads go through PlatformSettingsService's 5-second snapshot and a 5-second snapshot of the (small) allow-list;
 * a write drops this process's copies at once, other instances see it within the window.
 */
@Injectable()
export class UnofficialWhatsappSwitch implements UnofficialWhatsappGate {
  private allowed: { at: number; ids: ReadonlySet<number> } | null = null;
  private inflight: Promise<ReadonlySet<number>> | null = null;
  private generation = 0;
  /** How long a read of the allow-list is reused. A field so a test harness that adds rows behind the service's back can turn it to 0. */
  allowCacheMs = ALLOW_CACHE_MS;

  constructor(
    private readonly store: PlatformSettingsService,
    private readonly platform: PlatformStore,
  ) {}

  async isEnabled(): Promise<boolean> {
    return (await this.store.get<unknown>(UNOFFICIAL_WHATSAPP_KEY)) === true;
  }

  async assertEnabled(): Promise<void> {
    if (!(await this.isEnabled())) throw unofficialDisabled();
  }

  async isEnabledFor(orgId: number): Promise<boolean> {
    if (!(await this.isEnabled())) return false;
    return (await this.allowList()).has(Number(orgId));
  }

  async assertEnabledFor(orgId: number): Promise<void> {
    if (!(await this.isEnabledFor(orgId))) throw unofficialDisabled();
  }

  async enabledOrgIds(): Promise<ReadonlySet<number>> {
    if (!(await this.isEnabled())) return new Set<number>();
    return this.allowList();
  }

  /** How many workspaces are on the allow-list, read fresh (the admin console's count), whether or not the platform switch is on. */
  async allowedCount(): Promise<number> {
    return this.platform.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT count(*)::int AS n FROM unofficial_whatsapp_workspaces`,
      );
      return Number((res.rows[0] as { n: number | string } | undefined)?.n ?? 0);
    });
  }

  /** Drops this process's copy of the allow-list; the admin write calls it so the next read sees the change at once. */
  invalidateAllowList(): void {
    this.allowed = null;
    this.generation += 1;
    this.inflight = null;
  }

  private async allowList(): Promise<ReadonlySet<number>> {
    const now = Date.now();
    if (this.allowed && now - this.allowed.at < this.allowCacheMs) return this.allowed.ids;
    if (this.inflight) return this.inflight;
    const generation = this.generation;
    const load = this.platform
      .tx(async (tx) => {
        const res = await tx.execute(sql`SELECT org_id FROM unofficial_whatsapp_workspaces`);
        const ids = new Set(
          (res.rows as Array<{ org_id: number | string }>).map((r) => Number(r.org_id)),
        );
        // A write that landed while this read was in flight must not be overwritten by it.
        if (generation === this.generation) this.allowed = { at: Date.now(), ids };
        return ids as ReadonlySet<number>;
      })
      .finally(() => {
        if (this.inflight === load) this.inflight = null;
      });
    this.inflight = load;
    return load;
  }
}

export function unofficialDisabled(): AppError {
  return new AppError(
    ERROR_CODES.WA_UNOFFICIAL_DISABLED,
    'The unofficial WhatsApp engine is turned off on this platform. Use a WhatsApp Cloud API number.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}
