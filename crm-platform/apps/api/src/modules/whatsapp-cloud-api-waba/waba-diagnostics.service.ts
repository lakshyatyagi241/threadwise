import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WABA_COEXISTENCE_FIELDS,
  type WabaInboundCheck,
  type WabaInboundVerdict,
  type WabaWebhookConfig,
  type WabaWebhookStatus,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  WABA_ADMIN,
  type WabaAdminPort,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import { WabaApiError } from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { WabaConfigService } from './waba-config.service';
import { WabaConnectService } from './waba-connect.service';
import { WabaConnectionsRepository } from './waba-connections.repository';
import { inboundUrlKey, verifyTokenFor, webhookUrl } from './waba-rules';

const REQUIRED = [...WABA_COEXISTENCE_FIELDS];
const trim = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);
const same = (a: string, b: string) =>
  a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

/**
 * Webhook diagnostics (WD-WABA-002, 003, 015): is the platform's Meta app subscribed to the fields coexistence needs, subscribe the
 * missing ones, and ask Meta where one number's events actually go. Every Meta call has a timeout and happens in the request.
 * A check that cannot finish is a result (`error`), not an exception, so the panel always has something to show.
 */
@Injectable()
export class WabaDiagnosticsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cfg: WabaConfigService,
    private readonly repo: WabaConnectionsRepository,
    private readonly crypto: CryptoService,
    private readonly connections: WabaConnectService,
    private readonly config: ConfigService<Env, true>,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
    @Inject(WABA_ADMIN) private readonly admin: WabaAdminPort,
  ) {}

  /** The callback this platform registers with Meta and the token Meta must echo (the same values the console page shows). */
  callback(): { url: string | null; verifyToken: string } {
    const key = this.config.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true });
    const base = this.env.WABA_WEBHOOK_PUBLIC_URL ?? this.config.get('APP_URL', { infer: true });
    return {
      url: webhookUrl(base, inboundUrlKey(key)),
      verifyToken: verifyTokenFor(
        this.env.WABA_VERIFY_TOKEN ?? this.config.get('WHATSAPP_VERIFY_TOKEN', { infer: true }),
        key,
      ),
    };
  }

  /** `GET /v2/waba/webhook-config`: the values for a customer's own Meta app. */
  webhookConfig(): WabaWebhookConfig {
    const cb = this.callback();
    return {
      webhookUrl: cb.url,
      verifyToken: cb.verifyToken,
      fields: ['messages', 'message_template_status_update'],
    };
  }

  // --- the platform app (WD-WABA-002, 003) --------------------------------------------------------

  async webhookStatus(): Promise<WabaWebhookStatus> {
    await this.cfg.refresh();
    const app = this.app();
    const empty = { ok: false, subscribed: [], missing: [...REQUIRED], callbackUrl: null };
    if (!app) {
      return {
        ...empty,
        error: 'Set the Meta App ID and App Secret, save them, then check again.',
      };
    }
    try {
      const s = await this.admin.getAppSubscription(app);
      if (!s.hasWabaObject) {
        return {
          ...empty,
          error:
            'No WhatsApp Business Account webhook is configured on this Meta app yet. Set the callback in the app dashboard first.',
        };
      }
      const missing = REQUIRED.filter((f) => !s.fields.includes(f));
      return {
        ok: missing.length === 0,
        subscribed: s.fields,
        missing,
        callbackUrl: s.callbackUrl,
        error: null,
      };
    } catch (e) {
      return { ...empty, error: this.metaFailure('check', e) };
    }
  }

  /**
   * Subscribes the app to every coexistence field, keeping each field it already has and the callback Meta has on file (this
   * platform's own when it has none). Meta checks the callback during the call, with the token the webhook handshake compares.
   */
  async subscribeFields(): Promise<WabaWebhookStatus> {
    await this.cfg.refresh();
    const app = this.app();
    if (!app) throw AppError.validation('Set the Meta App ID and App Secret first.');
    const before = await this.webhookStatus();
    if (before.error && before.subscribed.length === 0 && !before.callbackUrl) {
      throw AppError.validation(before.error);
    }
    const cb = this.callback();
    const callbackUrl = before.callbackUrl ?? cb.url;
    if (!callbackUrl)
      throw AppError.validation('This platform has no public URL for Meta to call yet.');
    const fields = [...new Set([...before.subscribed, ...REQUIRED])];
    try {
      await this.admin.setAppSubscription(app, {
        callbackUrl,
        verifyToken: cb.verifyToken,
        fields,
      });
    } catch (e) {
      throw AppError.validation(this.metaFailure('subscribe', e));
    }
    const after = await this.webhookStatus();
    return { ...after, subscribedNow: after.ok };
  }

  // --- one number (WD-WABA-015) ----------------------------------------------------------------------

  async inboundCheck(uuid: string): Promise<WabaInboundCheck> {
    const { orgId } = RequestContextStore.require();
    const resolved = await this.db.tx((tx) =>
      this.connections.resolveConnection(tx, orgId, { uuid }),
    );
    if (!resolved) throw AppError.notFound('WhatsApp number', uuid);
    if (!resolved.conn) {
      throw AppError.validation(
        'This number has no WABA id or access token stored. Reconnect it first.',
      );
    }
    let apps;
    try {
      apps = await this.admin.getSubscriptionDetails(resolved.conn);
    } catch (e) {
      throw AppError.validation(this.metaFailure('read', e));
    }
    await this.cfg.refresh();
    const ours = this.callback().url;
    const verdict: WabaInboundVerdict =
      apps.length === 0
        ? 'not_subscribed'
        : ours && apps.some((a) => a.callbackUrl && same(a.callbackUrl, ours))
          ? 'delivering_here'
          : apps.some((a) => a.callbackUrl)
            ? 'wrong_url'
            : 'subscribed_default';
    const notes: WabaInboundCheck['notes'] = [];
    if (
      verdict !== 'not_subscribed' &&
      verdict !== 'delivering_here' &&
      !(await this.hasSecret(orgId, uuid))
    ) {
      notes.push('no_secret');
    }
    return { verdict, apps, notes };
  }

  // --- internals ---------------------------------------------------------------------------------

  private app(): { id: string; secret: string } | null {
    return this.env.META_APP_ID && this.env.META_APP_SECRET
      ? { id: this.env.META_APP_ID, secret: this.env.META_APP_SECRET }
      : null;
  }

  /** A number on the customer's own app signs with that app's secret, kept with its credentials; otherwise the platform's. */
  private async hasSecret(orgId: number, uuid: string): Promise<boolean> {
    if (this.app()) return true;
    const row = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid));
    if (!row?.credentials_json) return false;
    try {
      return Boolean(
        (JSON.parse(this.crypto.decrypt(row.credentials_json)) as { app_secret?: string })
          .app_secret,
      );
    } catch {
      return false;
    }
  }

  private metaFailure(what: 'check' | 'subscribe' | 'read', e: unknown): string {
    const err = e instanceof WabaApiError ? e : WabaApiError.network(e);
    if (err.status === 0) return `Could not reach Meta: ${trim(err.message, 200)}`;
    const msg = trim(err.message, 300);
    if (what === 'subscribe') {
      return `Meta rejected the subscribe: ${msg}. Check that Meta can reach this platform's callback URL and that the verify token matches.`;
    }
    if (what === 'read') return `Meta rejected the subscribed-apps read: ${msg}`;
    return `Meta rejected the check: ${msg}. Verify the App ID and App Secret.`;
  }
}
