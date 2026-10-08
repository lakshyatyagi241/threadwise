import { REALTIME_VISIBILITY_REPORT_MS } from '@crm/contracts';
import type { RealtimeClient } from './realtime-client';

/**
 * Tells the server whether this tab is in front, so the closed-tab browser push (BL-097) can skip a person who is looking at the app.
 *
 * A visible tab reports on every change, when the connection (re)opens, and every 15 s; a hidden one reports once ("hidden") and then
 * stays quiet, because the server forgets a tab 35 s after its last "visible". Nothing is reported without a connection, and a report
 * carries nothing but `{ visible }`. No React in here, so it is tested with fakes.
 */
export function startVisibilityReport(
  client: Pick<RealtimeClient, 'reportVisible' | 'onStatus'>,
  doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  timers: {
    setInterval: (fn: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
  } = {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
  },
  everyMs: number = REALTIME_VISIBILITY_REPORT_MS,
): () => void {
  const visible = () => doc.visibilityState === 'visible';
  const report = () => client.reportVisible(visible());
  const repeat = () => {
    if (visible()) client.reportVisible(true);
  };
  const hide = () => client.reportVisible(false);

  report();
  const handle = timers.setInterval(repeat, everyMs);
  doc.addEventListener('visibilitychange', report);
  win.addEventListener('pagehide', hide);
  const offStatus = client.onStatus(report);

  return () => {
    timers.clearInterval(handle);
    doc.removeEventListener('visibilitychange', report);
    win.removeEventListener('pagehide', hide);
    offStatus();
    hide();
  };
}
