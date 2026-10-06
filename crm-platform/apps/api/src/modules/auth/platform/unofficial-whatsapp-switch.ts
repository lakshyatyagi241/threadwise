import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { UnofficialWhatsappGate } from '../unofficial-whatsapp.port';
import { PlatformSettingsService } from './platform-settings.service';

/** The one `platform_settings` key behind the switch. A plain JSON boolean; a missing row is off. */
export const UNOFFICIAL_WHATSAPP_KEY = 'wa.unofficial.enabled';

/**
 * Whether the unofficial WhatsApp engine may be used at all (owner decision 2026-10-05: only the official Cloud API / BSP
 * route is supported; the Baileys engine stays in the code, default OFF, and only a platform super admin can turn it on).
 * Reads go through PlatformSettingsService's 5-second snapshot, a write drops this process's snapshot at once.
 */
@Injectable()
export class UnofficialWhatsappSwitch implements UnofficialWhatsappGate {
  constructor(private readonly store: PlatformSettingsService) {}

  async isEnabled(): Promise<boolean> {
    return (await this.store.get<unknown>(UNOFFICIAL_WHATSAPP_KEY)) === true;
  }

  async assertEnabled(): Promise<void> {
    if (!(await this.isEnabled())) throw unofficialDisabled();
  }
}

export function unofficialDisabled(): AppError {
  return new AppError(
    ERROR_CODES.WA_UNOFFICIAL_DISABLED,
    'The unofficial WhatsApp engine is turned off on this platform. Use a WhatsApp Cloud API number.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}
