import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAIL_MICROSOFT_CALLBACK_PATH } from '@crm/contracts';
import { channelEmailEnv } from '../../config/domains/channel-email.env';
import type { Env } from '../../config/env.schema';
import type { MicrosoftMailCredentials } from '../../infra/providers/channel-email';
import { SettingsService } from '../platform-settings-branding-storage';

/** The platform settings group the operator console edits. */
const GROUP = 'microsoftMail' as const;

/**
 * The platform's Microsoft Entra app for mail (TW-MAIL-034): what the operator saved on the console's Microsoft mail page, with the
 * `MICROSOFT_MAIL_*` environment values as the fallback for a field left empty (the same precedence as `GoogleMailConfig`). A workspace
 * never supplies or sees these. An unreadable settings document never takes mail down: the environment values alone then apply.
 */
@Injectable()
export class MicrosoftMailConfig {
  private readonly logger = new Logger(MicrosoftMailConfig.name);
  private readonly appUrl: string;

  constructor(
    private readonly settings: SettingsService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  /** The address registered at Microsoft when the operator does not override it. */
  get defaultRedirectUri(): string {
    return `${this.appUrl}${MAIL_MICROSOFT_CALLBACK_PATH}`;
  }

  private async saved(): Promise<{
    enabled?: boolean;
    clientId?: string;
    tenant?: string;
    redirectUri?: string;
  }> {
    try {
      return await this.settings.values(GROUP);
    } catch (err) {
      this.logger.debug(
        { err: (err as Error).message },
        'microsoftMail settings group not readable; using the environment',
      );
      return {};
    }
  }

  /** The app to act as, or null when the platform has none (not set up, or switched off). */
  async credentials(): Promise<MicrosoftMailCredentials | null> {
    const env = channelEmailEnv();
    const saved = await this.saved();
    if (saved.enabled === false) return null;
    const clientId = saved.clientId || env.MICROSOFT_MAIL_CLIENT_ID;
    let secret: string | null = null;
    try {
      secret = await this.settings.secret(GROUP, 'clientSecret');
    } catch {
      secret = null;
    }
    const clientSecret = secret || env.MICROSOFT_MAIL_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      tenant: saved.tenant || env.MICROSOFT_MAIL_TENANT || 'common',
      redirectUri: saved.redirectUri || env.MICROSOFT_MAIL_REDIRECT_URI || this.defaultRedirectUri,
    };
  }

  async ready(): Promise<boolean> {
    return (await this.credentials()) !== null;
  }
}
