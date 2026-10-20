import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { conferencingCallbackPath } from '@crm/contracts';
import { meetingConferencingEnv } from '../../config/domains/meeting-conferencing.env';
import { microsoftCalendarEnv } from '../../config/domains/microsoft-calendar.env';
import type { Env } from '../../config/env.schema';
import type {
  ProviderCredentials,
  ProviderCredentialsSource,
} from '../../infra/providers/meeting-conferencing';
import { SettingsService } from '../platform-settings-branding-storage';

const appUrlOf = (config: ConfigService<Env, true>): string =>
  config.get('APP_URL', { infer: true }).replace(/\/$/, '');

/** What is set for a provider, without any value: the operator's read-only checklist and the cards' "configured" both read it. */
export interface CredentialsReport {
  source: 'environment' | 'console' | 'none';
  hasClientId: boolean;
  hasClientSecret: boolean;
  /** The Microsoft Calendar integration is switched off in the console (Teams only). */
  switchedOff: boolean;
  /** The address to register at the provider. */
  redirectUri: string;
}

export interface InspectableCredentialsSource extends ProviderCredentialsSource {
  describe(): Promise<CredentialsReport>;
}

/**
 * The platform's Zoom OAuth app (BL-360): `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET` from the environment. A workspace never supplies or sees
 * these. There is no console page for them yet (BL-368): the operator sets the environment values, see docs/runbooks/video-conferencing-setup.md.
 */
@Injectable()
export class ZoomCredentialsSource implements InspectableCredentialsSource {
  private readonly appUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.appUrl = appUrlOf(config);
  }

  get defaultRedirectUri(): string {
    return `${this.appUrl}${conferencingCallbackPath('zoom')}`;
  }

  async describe(): Promise<CredentialsReport> {
    const env = meetingConferencingEnv();
    return {
      source: env.ZOOM_CLIENT_ID || env.ZOOM_CLIENT_SECRET ? 'environment' : 'none',
      hasClientId: !!env.ZOOM_CLIENT_ID,
      hasClientSecret: !!env.ZOOM_CLIENT_SECRET,
      switchedOff: false,
      redirectUri: env.ZOOM_REDIRECT_URI || this.defaultRedirectUri,
    };
  }

  async credentials(): Promise<ProviderCredentials | null> {
    const env = meetingConferencingEnv();
    if (!env.ZOOM_CLIENT_ID || !env.ZOOM_CLIENT_SECRET) return null;
    return {
      clientId: env.ZOOM_CLIENT_ID,
      clientSecret: env.ZOOM_CLIENT_SECRET,
      redirectUri: env.ZOOM_REDIRECT_URI || this.defaultRedirectUri,
    };
  }
}

/**
 * The Microsoft Entra app Teams meetings are made through (BL-360). A deployment may set `TEAMS_CLIENT_ID` and `TEAMS_CLIENT_SECRET` for an
 * app of its own; otherwise it is the app the operator already saved for the calendar (console, Microsoft Calendar page, or its environment
 * fallback), so there is nothing new to configure beyond adding the `OnlineMeetings.ReadWrite` delegated permission and this module's
 * redirect address to that app. Switching the calendar integration off on the console switches Teams off with it.
 */
@Injectable()
export class TeamsCredentialsSource implements InspectableCredentialsSource {
  private readonly logger = new Logger(TeamsCredentialsSource.name);
  private readonly appUrl: string;

  constructor(
    private readonly settings: SettingsService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = appUrlOf(config);
  }

  get defaultRedirectUri(): string {
    return `${this.appUrl}${conferencingCallbackPath('teams')}`;
  }

  /** Reads the app Teams would use and says where it came from; `clientId` and `clientSecret` are the values, or empty. */
  private async resolve(): Promise<
    CredentialsReport & { clientId: string; clientSecret: string; tenant: string }
  > {
    const env = meetingConferencingEnv();
    const redirectUri = env.TEAMS_REDIRECT_URI || this.defaultRedirectUri;
    if (env.TEAMS_CLIENT_ID && env.TEAMS_CLIENT_SECRET) {
      return {
        source: 'environment',
        hasClientId: !!env.TEAMS_CLIENT_ID,
        hasClientSecret: !!env.TEAMS_CLIENT_SECRET,
        switchedOff: false,
        redirectUri,
        clientId: env.TEAMS_CLIENT_ID ?? '',
        clientSecret: env.TEAMS_CLIENT_SECRET ?? '',
        tenant: env.TEAMS_TENANT || 'common',
      };
    }
    // The calendar's app: what the operator saved on the console, else the environment's (the same precedence as the calendar itself).
    const cal = microsoftCalendarEnv();
    let saved: { enabled?: boolean; clientId?: string; tenant?: string } = {};
    try {
      saved = await this.settings.values('microsoftCalendar');
    } catch (err) {
      this.logger.debug(
        { err: (err as Error).message },
        'microsoftCalendar settings group not readable; using the environment',
      );
    }
    let secret: string | null = null;
    try {
      secret = await this.settings.secret('microsoftCalendar', 'clientSecret');
    } catch {
      secret = null;
    }
    const clientId = saved.clientId || cal.MICROSOFT_CALENDAR_CLIENT_ID || '';
    const clientSecret = secret || cal.MICROSOFT_CALENDAR_CLIENT_SECRET || '';
    const fromConsole = !!saved.clientId || !!secret;
    return {
      source: !clientId && !clientSecret ? 'none' : fromConsole ? 'console' : 'environment',
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      switchedOff: saved.enabled === false,
      redirectUri,
      clientId,
      clientSecret,
      tenant: saved.tenant || cal.MICROSOFT_CALENDAR_TENANT || 'common',
    };
  }

  async describe(): Promise<CredentialsReport> {
    const {
      clientId: _id,
      clientSecret: _secret,
      tenant: _tenant,
      ...report
    } = await this.resolve();
    return report;
  }

  async credentials(): Promise<ProviderCredentials | null> {
    const r = await this.resolve();
    // The calendar's switch only applies to the calendar's app: a separate Teams app is not affected by it.
    if (r.switchedOff || !r.clientId || !r.clientSecret) return null;
    return {
      clientId: r.clientId,
      clientSecret: r.clientSecret,
      tenant: r.tenant,
      redirectUri: r.redirectUri,
    };
  }
}
