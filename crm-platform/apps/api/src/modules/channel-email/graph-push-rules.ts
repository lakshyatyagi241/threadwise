import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { MAIL_MICROSOFT_PUSH_PATH } from '@crm/contracts';

// Pure rules of Microsoft Graph change notifications (E-17, the Microsoft half of TW-MAIL-033). No I/O.

/** `mail_mailboxes.push_state.kind` of a Graph subscription. */
export const GRAPH_SUBSCRIPTION_KIND = 'graph-subscription';
/** The only resource watched: new mail in the Inbox, the same folder the delta sync reads. */
export const GRAPH_SUBSCRIPTION_RESOURCE = "me/mailFolders('inbox')/messages";
/** The public route Microsoft calls (notifications, lifecycle events and the validation handshake all arrive here). */
export const MICROSOFT_PUSH_PATH = MAIL_MICROSOFT_PUSH_PATH;
/** What we ask for. Graph allows at most 4230 minutes (under three days) for mail; a little less leaves room for clock skew. */
export const GRAPH_SUBSCRIPTION_MINUTES = 4_200;
/** The longest validation token we echo: Microsoft's are a few hundred characters at most. */
export const VALIDATION_TOKEN_MAX = 1_000;

const mac = (key: Buffer, orgId: number, mailboxUuid: string): string =>
  createHmac('sha256', key).update(`graph-push:${orgId}:${mailboxUuid}`).digest('base64url');

/**
 * The secret Microsoft hands back with every notification of a subscription (`clientState`, at most 128 characters). It names the
 * workspace and mailbox and carries an HMAC of both, so a notification can be checked without storing a secret per subscription and a
 * forged one (anyone can POST to a public URL) is recognised by its signature alone. The key is the mail state key (`deriveStateKey`,
 * HKDF of the credentials key); the signed text starts with `graph-push:`, which no OAuth state payload (base64url JSON) can, so the
 * two uses of the key cannot be swapped.
 */
export const clientStateOf = (key: Buffer, orgId: number, mailboxUuid: string): string =>
  `${orgId}.${mailboxUuid}.${mac(key, orgId, mailboxUuid)}`;

export function verifyClientState(
  key: Buffer,
  clientState: string | null | undefined,
): { orgId: number; mailboxUuid: string } | null {
  const m = /^(\d{1,15})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(clientState ?? '');
  if (!m) return null;
  const orgId = Number(m[1]);
  const given = Buffer.from(m[3]!);
  const want = Buffer.from(mac(key, orgId, m[2]!));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  return { orgId, mailboxUuid: m[2]! };
}

/** One entry of the `value` array Graph posts. Lifecycle events carry `lifecycleEvent`; plain changes carry `changeType`. */
export const graphNotificationSchema = z.object({
  subscriptionId: z.string().min(1).max(200),
  clientState: z.string().max(200).nullish(),
  changeType: z.string().max(40).nullish(),
  lifecycleEvent: z.string().max(40).nullish(),
  resource: z.string().max(500).nullish(),
});
export type GraphNotification = z.infer<typeof graphNotificationSchema>;

export const graphNotificationBodySchema = z.object({
  value: z.array(z.unknown()).max(200),
});

/** The notifications of a body that are well formed; anything else in the array is dropped. */
export function notificationsOf(body: unknown): GraphNotification[] | null {
  const parsed = graphNotificationBodySchema.safeParse(body);
  if (!parsed.success) return null;
  const out: GraphNotification[] = [];
  for (const raw of parsed.data.value) {
    const one = graphNotificationSchema.safeParse(raw);
    if (one.success) out.push(one.data);
  }
  return out;
}

/** What to do with a verified notification. */
export type NotificationAction = 'sync' | 'renew' | 'forget';

/**
 * A change (`created`) and a `missed` event both mean "read the Inbox again"; `reauthorizationRequired` means the subscription must be
 * renewed now (and mail may have been missed); `subscriptionRemoved` means Graph deleted it (we forget it and the sweep starts a new one).
 */
export function actionOf(n: Pick<GraphNotification, 'lifecycleEvent'>): NotificationAction {
  switch (n.lifecycleEvent) {
    case 'reauthorizationRequired':
      return 'renew';
    case 'subscriptionRemoved':
      return 'forget';
    default:
      return 'sync';
  }
}

/** When the subscription is due for renewal: it has less than `renewBeforeMs` left (capped at half the lifetime), or a renewal was asked for. */
export function renewalDue(
  state: { expiresAt?: unknown; renewNow?: unknown } | null,
  nowMs: number,
  renewBeforeMs: number,
): boolean {
  if (!state) return true;
  if (state.renewNow === true) return true;
  const t = typeof state.expiresAt === 'string' ? Date.parse(state.expiresAt) : NaN;
  if (!Number.isFinite(t)) return true;
  const cap = (GRAPH_SUBSCRIPTION_MINUTES * 60_000) / 2;
  return t - nowMs <= Math.min(renewBeforeMs, cap);
}

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
];

/**
 * Microsoft calls the notification URL from the internet: it must be HTTPS on a public host. A localhost, `.local`, `.internal` or private
 * address can never be reached, so push is not offered for it and the mailbox is polled.
 */
export function isPublicHttpsUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host.endsWith('.internal') || host.endsWith('.test') || !host.includes('.')) {
    return isIP(host) === 6 ? !/^(::1?$|f[cd]|fe80)/i.test(host) : false;
  }
  if (isIP(host) === 4) return !PRIVATE_V4.some((re) => re.test(host));
  return true;
}
