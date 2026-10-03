import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GOOGLE_CALENDAR_CALLBACK_PATH } from '@crm/contracts';
import { googleCalendarEnv } from '../../config/domains/appointments-booking.env';
import type { Env } from '../../config/env.schema';
import type { GoogleClientCredentials } from '../../infra/providers/appointments-booking';
import { SettingsService } from '../platform-settings-branding-storage';

/**
 * The platform's Google OAuth client (TW-APPT-028): what the operator saved on the console's Google Calendar page, with the
 * `GOOGLE_CALENDAR_*` environment values as the fallback for a field left empty (the same precedence as the mail and WhatsApp settings).
 * A workspace never supplies or sees these.
 */
@Injectable()
export class GoogleCalendarConfig {
  private readonly appUrl: string;

  constructor(
    private readonly settings: SettingsService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  /** The address registered at Google when the operator does not override it. */
  get defaultRedirectUri(): string {
    return `${this.appUrl}${GOOGLE_CALENDAR_CALLBACK_PATH}`;
  }

  /** The client to act as, or null when the platform has none (not set up, or switched off): nothing can then be connected or used. */
  async credentials(): Promise<GoogleClientCredentials | null> {
    const env = googleCalendarEnv();
    const saved = await this.settings.values('googleCalendar');
    if (!saved.enabled) return null;
    const clientId = saved.clientId || env.GOOGLE_CALENDAR_CLIENT_ID;
    const clientSecret =
      (await this.settings.secret('googleCalendar', 'clientSecret')) ||
      env.GOOGLE_CALENDAR_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      redirectUri: saved.redirectUri || env.GOOGLE_CALENDAR_REDIRECT_URI || this.defaultRedirectUri,
    };
  }
}
