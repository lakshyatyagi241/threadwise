import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAIL_GOOGLE_CALLBACK_PATH, MAIL_GOOGLE_PUSH_PATH } from '@crm/contracts';
import { channelEmailEnv } from '../../config/domains/channel-email.env';
import type { Env } from '../../config/env.schema';
import type { GoogleMailCredentials } from '../../infra/providers/channel-email';
import { SettingsService } from '../platform-settings-branding-storage';

export interface GoogleMailPushConfig {
  /** `projects/<project>/topics/<topic>`. */
  topic: string;
  /** What the push token's `aud` must equal. */
  audience: string;
  /** What the push token's `email` must equal. */
  serviceAccount: string;
}

/** The platform settings group the operator console edits (TW-MAIL-029). */
const GROUP = 'googleMail' as const;

/**
 * The platform's Google OAuth client for mail (TW-MAIL-029): what the operator saved on the console's Google mail page, with the
 * `GOOGLE_MAIL_*` environment values as the fallback for a field left empty (the same precedence as Google Calendar's). A workspace never
 * supplies or sees these. A different client from Calendar's on purpose: the Gmail scopes are restricted and the client needs Google's
 * verification.
 *
 * An unreadable settings document never takes mail down: the environment values alone then apply.
 */
@Injectable()
export class GoogleMailConfig {
  private readonly logger = new Logger(GoogleMailConfig.name);
  private readonly appUrl: string;

  constructor(
    private readonly settings: SettingsService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  /** The address registered at Google when the operator does not override it. */
  get defaultRedirectUri(): string {
    return `${this.appUrl}${MAIL_GOOGLE_CALLBACK_PATH}`;
  }

  private async saved(): Promise<{
    enabled?: boolean;
    clientId?: string;
    redirectUri?: string;
    pubsubTopic?: string;
    pushAudience?: string;
    pushServiceAccount?: string;
  }> {
    try {
      return await this.settings.values(GROUP);
    } catch (err) {
      this.logger.debug(
        { err: (err as Error).message },
        'googleMail settings group not readable; using the environment',
      );
      return {};
    }
  }

  /** The client to act as, or null when the platform has none (not set up, or switched off): nothing can then be connected, synced or sent. */
  async credentials(): Promise<GoogleMailCredentials | null> {
    const env = channelEmailEnv();
    const saved = await this.saved();
    if (saved.enabled === false) return null;
    const clientId = saved.clientId || env.GOOGLE_MAIL_CLIENT_ID;
    let secret: string | null = null;
    try {
      secret = await this.settings.secret(GROUP, 'clientSecret');
    } catch {
      secret = null;
    }
    const clientSecret = secret || env.GOOGLE_MAIL_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      redirectUri: saved.redirectUri || env.GOOGLE_MAIL_REDIRECT_URI || this.defaultRedirectUri,
    };
  }

  /** The address Pub/Sub pushes to: this API's public push endpoint. */
  get pushEndpoint(): string {
    return `${this.appUrl}${MAIL_GOOGLE_PUSH_PATH}`;
  }

  /**
   * What Gmail push needs (TW-MAIL-033): the Pub/Sub topic the watch publishes to, the audience and the service account the push
   * subscription's token must carry. What the console saved, else the environment (the audience falls back to the push endpoint's own
   * address). Null when there is no topic or no service account, or the Gmail client itself is off: push is then not offered and every
   * push request is refused.
   */
  async push(): Promise<GoogleMailPushConfig | null> {
    if (!(await this.credentials())) return null;
    const env = channelEmailEnv();
    const saved = await this.saved();
    const topic = (saved.pubsubTopic || env.GOOGLE_MAIL_PUBSUB_TOPIC || '').trim();
    const serviceAccount = (
      saved.pushServiceAccount ||
      env.GOOGLE_MAIL_PUSH_SERVICE_ACCOUNT ||
      ''
    ).trim();
    if (!topic || !serviceAccount) return null;
    const audience = (
      saved.pushAudience ||
      env.GOOGLE_MAIL_PUSH_AUDIENCE ||
      this.pushEndpoint
    ).trim();
    return { topic, audience, serviceAccount };
  }

  async ready(): Promise<boolean> {
    return (await this.credentials()) !== null;
  }
}
