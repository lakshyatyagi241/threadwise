import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAIM_CHANNEL, EventClaimer, HIDDEN_DELAY_MS, type ClaimChannel } from './claim';

/** A BroadcastChannel stand-in: every channel with the same name hears the others (not itself), as the real one does. */
class FakeBus {
  private readonly members = new Set<FakeChannel>();
  create(name: string): ClaimChannel {
    const c = new FakeChannel(this, name);
    this.members.add(c);
    return c;
  }
  deliver(from: FakeChannel, name: string, data: unknown) {
    for (const m of this.members) if (m !== from && m.name === name && !m.closed) m.receive(data);
  }
}
class FakeChannel implements ClaimChannel {
  closed = false;
  private handlers: Array<(e: { data: unknown }) => void> = [];
  constructor(
    private readonly bus: FakeBus,
    readonly name: string,
  ) {}
  postMessage(message: unknown) {
    this.bus.deliver(this, this.name, message);
  }
  addEventListener(_type: 'message', h: (e: { data: unknown }) => void) {
    this.handlers.push(h);
  }
  receive(data: unknown) {
    for (const h of this.handlers) h({ data });
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('EventClaimer (one tab acts per event)', () => {
  it('lets the first visible tab win and the others stand down', async () => {
    const bus = new FakeBus();
    const a = new EventClaimer((n) => bus.create(n));
    const b = new EventClaimer((n) => bus.create(n));
    expect(await a.claim('alert:1', true)).toBe(true);
    expect(await b.claim('alert:1', true)).toBe(false);
  });

  it('claims each event separately', async () => {
    const bus = new FakeBus();
    const a = new EventClaimer((n) => bus.create(n));
    const b = new EventClaimer((n) => bus.create(n));
    expect(await a.claim('alert:1', true)).toBe(true);
    expect(await b.claim('alert:2', true)).toBe(true);
  });

  it('a hidden tab waits, so a visible tab claims first even when the hidden one asked earlier', async () => {
    const bus = new FakeBus();
    const hidden = new EventClaimer((n) => bus.create(n));
    const visible = new EventClaimer((n) => bus.create(n));
    const hiddenResult = hidden.claim('alert:1', false);
    expect(await visible.claim('alert:1', true)).toBe(true);
    await vi.advanceTimersByTimeAsync(HIDDEN_DELAY_MS);
    expect(await hiddenResult).toBe(false);
  });

  it('a hidden tab acts when no visible tab claimed', async () => {
    const bus = new FakeBus();
    const hidden = new EventClaimer((n) => bus.create(n));
    const other = new EventClaimer((n) => bus.create(n));
    const result = hidden.claim('alert:1', false);
    await vi.advanceTimersByTimeAsync(HIDDEN_DELAY_MS);
    expect(await result).toBe(true);
    expect(await other.claim('alert:1', false)).toBe(false);
  });

  it('every tab acts where there is no BroadcastChannel', async () => {
    const a = new EventClaimer(() => null);
    expect(await a.claim('alert:1', true)).toBe(true);
    expect(await a.claim('alert:1', true)).toBe(true);
  });

  it('uses the agreed channel name and survives a closed channel', async () => {
    const names: string[] = [];
    const bus = new FakeBus();
    const a = new EventClaimer((n) => {
      names.push(n);
      return bus.create(n);
    });
    expect(names).toEqual([CLAIM_CHANNEL]);
    a.close();
    expect(await a.claim('alert:9', true)).toBe(true);
  });

  it('forgets claims after a minute', async () => {
    let now = 0;
    const bus = new FakeBus();
    const a = new EventClaimer(
      (n) => bus.create(n),
      () => now,
    );
    const b = new EventClaimer(
      (n) => bus.create(n),
      () => now,
    );
    await a.claim('alert:1', true);
    expect(await b.claim('alert:1', true)).toBe(false);
    now = 61_000;
    expect(await b.claim('alert:1', true)).toBe(true);
  });
});
