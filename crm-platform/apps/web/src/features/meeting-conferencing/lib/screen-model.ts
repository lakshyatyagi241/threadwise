import { CONNECTED_VIDEO_PROVIDERS, type ConnectedVideoProvider } from '@crm/contracts';

/** What the provider's redirect left in the address (`?video=<outcome>&provider=zoom`), plus the ticket to confirm. */
export type Outcome =
  | { kind: 'confirm'; provider: ConnectedVideoProvider; ticket: string }
  | {
      kind: 'connected' | 'denied' | 'failed' | 'expired' | 'not_configured' | 'notYours';
      provider: ConnectedVideoProvider;
    };

const KINDS = ['denied', 'failed', 'expired', 'not_configured'] as const;
const PARAMS = ['video', 'provider', 'ticket'] as const;

export function readOutcome(search: string): Outcome | null {
  const q = new URLSearchParams(search);
  const provider = q.get('provider');
  const video = q.get('video');
  if (!provider || !video) return null;
  if (!(CONNECTED_VIDEO_PROVIDERS as readonly string[]).includes(provider)) return null;
  const p = provider as ConnectedVideoProvider;
  if (video === 'confirm') {
    const ticket = q.get('ticket');
    return ticket ? { kind: 'confirm', provider: p, ticket } : null;
  }
  return (KINDS as readonly string[]).includes(video)
    ? { kind: video as (typeof KINDS)[number], provider: p }
    : null;
}

/** The same query string without the outcome (and the ticket, which is good once), so a reload does not show or reuse them. */
export function withoutOutcome(search: string): string {
  const q = new URLSearchParams(search);
  for (const k of PARAMS) q.delete(k);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Only an http(s) address is followed (a response must never be able to send the browser to a `javascript:` address). */
export function safeConsentUrl(url: string, base = 'http://localhost'): string | null {
  try {
    const u = new URL(url, base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
