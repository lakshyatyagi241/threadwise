import { Inject, Injectable } from '@nestjs/common';
import type { WabaHealth } from '@crm/contracts';
import {
  WABA_ADMIN,
  type WabaAdminPort,
  type WabaConnection,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import {
  WabaApiError,
  describeMetaError,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { conversationsFrom } from './waba-extras-rules';
import {
  WABA_TEMPLATES,
  type WabaTemplatePort,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-template.port';

type Details = WabaHealth['details'];

/** Facts for `deriveHealth` that come from the extra Meta reads. */
export interface DetailFacts {
  accountReviewStatus: string | null;
  businessVerificationStatus: string | null;
  tokenScopes: string[] | null;
  subscribedApps: number | null;
  templatesErrorCode: number | null;
}

/** The current calendar month in unix seconds, up to now. */
function monthWindow(now: Date): { start: number; end: number } {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000;
  return { start, end: Math.floor(now.getTime() / 1000) };
}

const reason = (e: unknown): string =>
  e instanceof WabaApiError
    ? (describeMetaError((e.body as { error?: never } | null)?.error ?? null) ?? e.message)
    : (e as Error).message;

/**
 * The reads behind the health page beyond the phone node (TW-WABA-021): the WABA node, the token, the webhook subscription and
 * a template tally. They run in parallel and are independent, so one failing node never blanks the page; each failure is
 * listed in `errors`.
 */
@Injectable()
export class WabaHealthDetailsService {
  constructor(
    @Inject(WABA_ADMIN) private readonly admin: WabaAdminPort,
    @Inject(WABA_TEMPLATES) private readonly templates: WabaTemplatePort,
  ) {}

  async collect(
    conn: WabaConnection,
    phone: {
      accountMode: string | null;
      isOfficialBusinessAccount: boolean | null;
      isPinEnabled: boolean | null;
    },
  ): Promise<{ details: Details; facts: DetailFacts }> {
    const month = monthWindow(new Date());
    const [waba, apps, token, tpl, analytics] = await Promise.allSettled([
      this.admin.getWabaDetails(conn),
      this.admin.getSubscribedApps(conn),
      conn.accessToken ? this.admin.inspectToken(conn.accessToken) : Promise.resolve(null),
      this.templates.list(conn, { limit: 100 }),
      Promise.resolve().then(() =>
        this.admin.getConversationAnalytics(conn, month.start, month.end),
      ),
    ]);
    const errors: string[] = [];
    const fail = (what: string, r: PromiseRejectedResult) =>
      errors.push(`${what}: ${reason(r.reason)}`);

    if (waba.status === 'rejected') fail('WhatsApp Business Account', waba);
    if (apps.status === 'rejected') fail('Webhook subscription', apps);
    // The platform may have no app credentials to inspect with: that is "unknown", not an error.
    if (token.status === 'rejected' && !/META_APP_ID|not configured/i.test(reason(token.reason)))
      fail('Token inspection', token);
    if (tpl.status === 'rejected') fail('Templates', tpl);

    const byStatus: Record<string, number> = {};
    if (tpl.status === 'fulfilled')
      for (const t of tpl.value.items) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const inspected = token.status === 'fulfilled' ? token.value : null;
    const w = waba.status === 'fulfilled' ? waba.value : null;

    return {
      details: {
        waba: w,
        token: {
          valid: inspected ? inspected.isValid : null,
          scopes: inspected?.scopes ?? [],
          expiresAt: inspected?.expiresAt ? inspected.expiresAt.toISOString() : null,
          appId: inspected?.appId ?? null,
        },
        webhook: apps.status === 'fulfilled' ? { subscribedApps: apps.value } : null,
        templates:
          tpl.status === 'fulfilled' ? { sampled: tpl.value.items.length, byStatus } : null,
        phone,
        // Optional: any failure or change of shape in Meta's analytics simply leaves the card out (TW-WABA-023).
        conversations: analytics.status === 'fulfilled' ? conversationsFrom(analytics.value) : null,
        errors,
      },
      facts: {
        accountReviewStatus: w?.accountReviewStatus ?? null,
        businessVerificationStatus: w?.businessVerificationStatus ?? null,
        tokenScopes: inspected ? inspected.scopes : null,
        subscribedApps: apps.status === 'fulfilled' ? apps.value.length : null,
        templatesErrorCode:
          tpl.status === 'rejected' && tpl.reason instanceof WabaApiError ? tpl.reason.code : null,
      },
    };
  }
}
