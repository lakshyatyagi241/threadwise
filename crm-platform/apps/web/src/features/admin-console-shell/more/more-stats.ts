import { humanShortNumber, type OverviewStatsResponse } from '@crm/contracts';

export interface FootContext {
  /** The plan's name, as the account menu shows it. */
  plan: string;
  /** The wallet balance text, or a dash. */
  balance: string;
  /** When the next scheduled send runs, in words, or a dash. */
  next: string;
}

type Values = Record<string, string | number>;

/** Reference's third integrations figure is the number it ships a connector for (HubSpot, Shopify, WooCommerce). */
const INTEGRATIONS_AVAILABLE = 3;

/**
 * The values for a catalogue card's one-line footer (TW-ASHELL-020). `{}` for a card whose footer is plain text, and `null`
 * when the figure it needs is not there (still loading, or its lookup failed), so the card shows no footer instead of a
 * wrong zero. Reference showed 0 for a failed lookup; a blank is the honest version of that.
 */
export function footValues(
  id: string,
  s: OverviewStatsResponse | undefined,
  ctx: FootContext,
): Values | null {
  const need = <T extends Record<string, number | null | undefined>>(
    fields: T,
    build: (v: { [K in keyof T]: number }) => Values,
  ): Values | null => {
    if (!s) return null;
    if (Object.values(fields).some((v) => v === null || v === undefined)) return null;
    return build(fields as { [K in keyof T]: number });
  };
  const live = s ?? undefined;
  switch (id) {
    case 'account':
      return s ? { plan: ctx.plan, balance: ctx.balance } : null;
    case 'pricing':
      return s ? { plan: ctx.plan } : null;
    case 'analytics':
      return need({ count: live?.outbound7d }, (v) => ({ count: humanShortNumber(v.count) }));
    case 'attributes':
      return need({ count: live?.attributes }, (v) => v);
    case 'contacts':
      return need({ people: live?.contacts, groups: live?.groups, tags: live?.tags }, (v) => v);
    case 'broadcasts':
      return need({ queued: live?.broadcastsQueued }, (v) => ({
        queued: v.queued,
        pct:
          live?.deliveredPct === null || live?.deliveredPct === undefined
            ? 'none'
            : live.deliveredPct,
      }));
    case 'auto-reply':
      return need({ count: live?.autoReplyRules }, (v) => ({
        count: v.count,
        pct:
          live?.autoReplyMatchPct === null || live?.autoReplyMatchPct === undefined
            ? 'none'
            : live.autoReplyMatchPct,
      }));
    case 'scheduled':
      return need({ queued: live?.scheduledQueued }, (v) => ({ queued: v.queued, next: ctx.next }));
    case 'message-history':
      return need({ count: live?.messageHistory }, (v) => ({ count: humanShortNumber(v.count) }));
    case 'notifications':
      return need({ count: live?.unreadNotifications }, (v) => v);
    case 'integrations':
      return need({ connected: live?.integrationsConnected }, (v) => ({
        connected: v.connected,
        available: INTEGRATIONS_AVAILABLE,
      }));
    case 'appointments':
      return need({ count: live?.bookingTypes }, (v) => v);
    case 'ai-assistants':
      return need({ configured: live?.assistantsConfigured, live: live?.assistantsLive }, (v) => v);
    case 'call-logs':
      return need({ calls: live?.calls24h, minutes: live?.callMinutes24h }, (v) => v);
    case 'forms':
      return need({ drafted: live?.formsDrafted, live: live?.formsLive }, (v) => v);
    case 'wa-links':
      return need({ links: live?.chatLinks, clicks: live?.chatLinkClicks }, (v) => ({
        links: v.links,
        clicks: humanShortNumber(v.clicks),
      }));
    case 'chatbot-widgets':
      return need({ built: live?.widgetsBuilt, live: live?.widgetsLive }, (v) => v);
    case 'ai-training':
      return need({ count: live?.agentsConfigured }, (v) => v);
    case 'ai-usage':
      return need({ tokens: live?.aiTokensThisMonth }, (v) => ({
        tokens: humanShortNumber(v.tokens),
      }));
    case 'flow-analytics':
      return need({ count: live?.flowFailedRuns }, (v) => v);
    case 'webhooks':
      return need({ count: live?.webhookEndpoints }, (v) => v);
    case 'support':
      return need({ total: live?.supportTotal, open: live?.supportOpen }, (v) => v);
    case 'activity-log':
      return need({ count: live?.activity24h }, (v) => v);
    case 'guidebook':
      return need({ count: live?.guidebookArticles }, (v) => v);
    case 'channels':
      return need({ active: live?.devicesActive, total: live?.devicesTotal }, (v) => v);
    case 'team-members':
      return need({ count: live?.seats }, (v) => v);
    default:
      // Cards whose footer is a plain caption ("connect & manage", "growth tools").
      return {};
  }
}
