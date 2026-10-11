import { Injectable } from '@nestjs/common';
import { PlatformSettingsService } from '../auth';

/** The platform switch (a `platform_settings` row). Off unless a platform admin turns it on. */
export const SMS_ENABLED_KEY = 'sms_enabled';

/**
 * Whether the SMS channel is switched on for the platform (TW-SMS-025). It hides entry points (the menu, the pickers, the template
 * channel); it never blocks a sender that exists, so a workspace's running sends do not stop when an admin hides the menu.
 */
@Injectable()
export class SmsAvailability {
  constructor(private readonly settings: PlatformSettingsService) {}

  async platformEnabled(): Promise<boolean> {
    const v = await this.settings.get<unknown>(SMS_ENABLED_KEY);
    return v === true || v === 1 || v === '1' || v === 'true';
  }
}
