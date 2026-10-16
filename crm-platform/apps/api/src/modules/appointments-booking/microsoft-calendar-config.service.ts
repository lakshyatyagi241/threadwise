import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MICROSOFT_CALENDAR_CALLBACK_PATH } from '@crm/contracts';
import { microsoftCalendarEnv } from '../../config/domains/microsoft-calendar.env';
import type { Env } from '../../config/env.schema';
import type { MicrosoftClientCredentials } from '../../infra/providers/appointments-booking';
import { SettingsService } from '../platform-settings-branding-storage';

const GROUP = 'microsoftCalendar' as const;

/**
 * The platform's Microsoft Entra app for calendars (BL-035): what the operator saved on the console's Microsoft Calendar page, with the
 * `MICROSOFT_CALENDAR_*` environment values as the fallback for a field left empty (the same precedence as `GoogleCalendarConfig`). A
 * workspace never supplies or sees these. An unreadable settings document never takes bookings down: the environment values alone apply.
 */
@Injectable()
export class MicrosoftCalendarConfig {
  private readonly logger = new Logger(MicrosoftCalendarConfig.name);
  private readonly appUrl: string;

  constructor(
    private readonly settings: SettingsService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  /** The address registered at Microsoft when the operator does not override it. */
  get defaultRedirectUri(): string {
    return `${this.appUrl}${MICROSOFT_CALENDAR_CALLBACK_PATH}`;
  }

  /** The app to act as, or null when the platform has none (not set up, or switched off): nothing can then be connected or used. */
  async credentials(): Promise<MicrosoftClientCredentials | null> {
    const env = microsoftCalendarEnv();
    let saved: { enabled?: boolean; clientId?: string; tenant?: string; redirectUri?: string } = {};
    try {
      saved = await this.settings.values(GROUP);
    } catch (err) {
      this.logger.debug(
        { err: (err as Error).message },
        'microsoftCalendar settings group not readable; using the environment',
      );
    }
    if (saved.enabled === false) return null;
    const clientId = saved.clientId || env.MICROSOFT_CALENDAR_CLIENT_ID;
    let secret: string | null = null;
    try {
      secret = await this.settings.secret(GROUP, 'clientSecret');
    } catch {
      secret = null;
    }
    const clientSecret = secret || env.MICROSOFT_CALENDAR_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      tenant: saved.tenant || env.MICROSOFT_CALENDAR_TENANT || 'common',
      redirectUri:
        saved.redirectUri || env.MICROSOFT_CALENDAR_REDIRECT_URI || this.defaultRedirectUri,
    };
  }
}
