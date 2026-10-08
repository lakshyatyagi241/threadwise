import { describe, expect, it } from 'vitest';
import { startVisibilityReport } from './visibility-report';

/** Fakes for the three things the reporter touches: the client, the document and window, and the timer. */
function setup(initial: 'visible' | 'hidden' = 'visible') {
  const sent: boolean[] = [];
  let statusListener: (() => void) | undefined;
  const client = {
    reportVisible: (v: boolean) => void sent.push(v),
    onStatus: (l: () => void) => {
      statusListener = l;
      return () => {
        statusListener = undefined;
      };
    },
  };
  const docListeners = new Map<string, () => void>();
  const winListeners = new Map<string, () => void>();
  const doc = {
    visibilityState: initial as DocumentVisibilityState,
    addEventListener: (type: string, fn: () => void) => void docListeners.set(type, fn),
    removeEventListener: (type: string) => void docListeners.delete(type),
  };
  const win = {
    addEventListener: (type: string, fn: () => void) => void winListeners.set(type, fn),
    removeEventListener: (type: string) => void winListeners.delete(type),
  };
  let tick: (() => void) | undefined;
  let cleared = false;
  const timers = {
    setInterval: (fn: () => void) => {
      tick = fn;
      return 1;
    },
    clearInterval: () => {
      cleared = true;
    },
  };
  const stop = startVisibilityReport(client as never, doc as never, win as never, timers, 15_000);
  return {
    sent,
    stop,
    doc,
    docListeners,
    winListeners,
    tick: () => tick?.(),
    status: () => statusListener?.(),
    cleared: () => cleared,
    hasStatusListener: () => statusListener !== undefined,
  };
}

describe('reporting whether the tab is in front', () => {
  it('reports at once, and again on every interval while visible', () => {
    const h = setup('visible');
    expect(h.sent).toEqual([true]);
    h.tick();
    h.tick();
    expect(h.sent).toEqual([true, true, true]);
  });

  it('reports hidden once and then stays quiet (the server forgets a silent tab)', () => {
    const h = setup('hidden');
    expect(h.sent).toEqual([false]);
    h.tick();
    h.tick();
    expect(h.sent).toEqual([false]);
  });

  it('reports on every visibility change', () => {
    const h = setup('visible');
    h.doc.visibilityState = 'hidden';
    h.docListeners.get('visibilitychange')!();
    h.doc.visibilityState = 'visible';
    h.docListeners.get('visibilitychange')!();
    expect(h.sent).toEqual([true, false, true]);
  });

  it('reports again when the connection (re)opens, so a new socket is known to the server', () => {
    const h = setup('visible');
    h.status();
    expect(h.sent).toEqual([true, true]);
  });

  it('says hidden when the page is being closed', () => {
    const h = setup('visible');
    h.winListeners.get('pagehide')!();
    expect(h.sent).toEqual([true, false]);
  });

  it('cleans up after itself and leaves as hidden', () => {
    const h = setup('visible');
    h.stop();
    expect(h.cleared()).toBe(true);
    expect(h.docListeners.size).toBe(0);
    expect(h.winListeners.size).toBe(0);
    expect(h.hasStatusListener()).toBe(false);
    expect(h.sent.at(-1)).toBe(false);
  });
});
