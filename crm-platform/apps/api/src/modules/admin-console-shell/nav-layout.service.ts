import { Injectable } from '@nestjs/common';
import {
  NAV_LAYOUT_DEFAULT_BAR,
  navMoreZone,
  normalizeNavBar,
  resolveNavBar,
  type NavLayoutResponse,
} from '@crm/contracts';
import { AuthAuditService, PlatformSettingsService } from '../auth';

/** Platform setting that holds `{ bar: [...] }` (Reference: `user_nav_order`). */
export const NAV_LAYOUT_SETTING = 'shell.nav_layout';

/**
 * Which entries sit in the customer top bar (TW-ASHELL-009). One platform-wide
 * row, edited by super admins, read by every customer shell on load.
 */
@Injectable()
export class NavLayoutService {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly audit: AuthAuditService,
  ) {}

  async get(): Promise<NavLayoutResponse> {
    return this.shape(await this.settings.get<unknown>(NAV_LAYOUT_SETTING));
  }

  async save(operatorId: number, input: readonly unknown[]): Promise<NavLayoutResponse> {
    const bar = normalizeNavBar(input);
    await this.settings.set(NAV_LAYOUT_SETTING, { bar }, operatorId);
    // ponytail: settings write and audit are two transactions; a crash between them loses one audit row, never a setting.
    await this.audit.recordStandalone({
      event: 'platform.shell.nav_layout_saved',
      status: 'info',
      actorType: 'platform_operator',
      actorId: operatorId,
      payload: { bar },
    });
    return this.shape({ bar });
  }

  async reset(operatorId: number): Promise<NavLayoutResponse> {
    return this.save(operatorId, NAV_LAYOUT_DEFAULT_BAR);
  }

  private shape(stored: unknown): NavLayoutResponse {
    const bar = resolveNavBar(stored);
    return {
      bar,
      more: navMoreZone(bar),
      isDefault: bar.join() === NAV_LAYOUT_DEFAULT_BAR.join(),
    };
  }
}
