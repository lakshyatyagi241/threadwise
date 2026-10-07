/**
 * One tab pings and raises the desktop alert for an event; the others stay quiet. Every tab hears every event (each has its own
 * socket), so they agree through a `BroadcastChannel`: a tab that wants to act announces the event id first, and a tab that already
 * heard that announcement does not act.
 *
 * A visible tab claims at once, a hidden one after `HIDDEN_DELAY_MS`, so the tab the person is looking at wins when there is one.
 * Where `BroadcastChannel` does not exist (old Safari) every tab acts, which is acceptable. Two tabs claiming within the same
 * millisecond can both win: rare, and the cost is one extra ping.
 */

export const CLAIM_CHANNEL = 'crm-notify';
export const HIDDEN_DELAY_MS = 150;
/** Claims older than this are forgotten. */
const KEEP_MS = 60_000;

/** The part of `BroadcastChannel` used, so a test can stand in a fake. */
export interface ClaimChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void;
  close(): void;
}

interface ClaimMessage {
  kind: 'claim';
  key: string;
}

export class EventClaimer {
  private readonly heard = new Map<string, number>();
  private readonly channel: ClaimChannel | null;

  constructor(
    createChannel: (name: string) => ClaimChannel | null,
    private readonly now: () => number = Date.now,
  ) {
    this.channel = createChannel(CLAIM_CHANNEL);
    this.channel?.addEventListener('message', (event) => {
      const m = event.data as Partial<ClaimMessage> | null;
      if (m && m.kind === 'claim' && typeof m.key === 'string') this.heard.set(m.key, this.now());
    });
  }

  /**
   * Whether this tab should act on `key`. Resolves true at most once per key per tab, and false when another tab claimed first.
   * Call it with `await`: a hidden tab waits a moment so a visible one can go first.
   */
  async claim(key: string, visible: boolean): Promise<boolean> {
    this.prune();
    if (!this.channel) return true;
    if (this.heard.has(key)) return false;
    if (!visible) {
      await new Promise<void>((resolve) => setTimeout(resolve, HIDDEN_DELAY_MS));
      if (this.heard.has(key)) return false;
    }
    this.heard.set(key, this.now());
    try {
      this.channel.postMessage({ kind: 'claim', key } satisfies ClaimMessage);
    } catch {
      /* the channel closed: act anyway */
    }
    return true;
  }

  close(): void {
    try {
      this.channel?.close();
    } catch {
      /* already closed */
    }
  }

  private prune(): void {
    const cutoff = this.now() - KEEP_MS;
    for (const [key, at] of this.heard) if (at < cutoff) this.heard.delete(key);
  }
}

/** The real channel, or null where there is none (server render, old browsers). */
export function browserChannel(name: string): ClaimChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name);
  } catch {
    return null;
  }
}
