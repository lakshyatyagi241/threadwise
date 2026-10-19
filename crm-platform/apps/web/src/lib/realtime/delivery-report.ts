import { REALTIME_DELIVERY_REPORT_MS } from '@crm/contracts';
import type { RealtimeClient } from './realtime-client';

/**
 * Tells the server, about once a minute, how late events have been reaching this tab (EL-B23): the worst age of an event on arrival and
 * how many events that covers. It is the only way to see delivery to a browser, which the server cannot observe. Nothing is sent
 * without a connection or without events, and a report carries two numbers and nothing else. No React in here, so it is tested with fakes.
 */
export function startDeliveryReport(
  client: Pick<RealtimeClient, 'reportDelivery'>,
  timers: {
    setInterval: (fn: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
  } = {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
  },
  everyMs: number = REALTIME_DELIVERY_REPORT_MS,
): () => void {
  const handle = timers.setInterval(() => client.reportDelivery(), everyMs);
  return () => timers.clearInterval(handle);
}
