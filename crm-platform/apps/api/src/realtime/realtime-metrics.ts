import { REALTIME_DELIVERY_MIN_GAP_MS, realtimeDeliveryLagSchema } from '@crm/contracts';
import {
  getRuntimeMonitor,
  type Counter,
  type Gauge,
  type Histogram,
  type RuntimeMonitor,
} from '@crm/observability';

/**
 * Series for the realtime path (EL-B18), registered on the process's runtime monitor, so they are scraped with everything else and carry
 * the same `service`, `instance` and `release` labels. Nothing here measures delivery to a browser: the server cannot see a client
 * receive a packet. What it does show is what the realtime path costs and how it fails, from the side the server can observe.
 *
 *   crm_realtime_sockets                              connected sockets of this API process (gauge)
 *   crm_realtime_connections_total{outcome}           handshakes: accepted | refused
 *   crm_realtime_disconnects_total                    sockets that left
 *   crm_realtime_room_joins_total{result}             ok | forbidden | limit | invalid | unavailable
 *   crm_realtime_events_published_total{type}         events handed to Redis, by event type (a finite set from the contracts)
 *   crm_realtime_rooms_published_total                room deliveries those events fanned out to
 *   crm_realtime_publish_failures_total{type}         publishes that failed (logged, never thrown)
 *   crm_realtime_publish_duration_seconds             the publisher's own cost: the Redis sequence pipeline and the emit
 *   crm_realtime_rooms                                rooms held by this API process (gauge; socket.io keeps one private room per socket too)
 *   crm_realtime_delivery_lag_seconds                 how late events reached browsers: each connected tab reports the worst age of an event on
 *                                                     arrival over its last minute (an estimate against the server clock; see the contract)
 *
 * Without a monitor (tests, CLIs) every call is a no-op.
 */
interface Handles {
  sockets: Gauge;
  roomsHeld: Gauge;
  deliveryLag: Histogram;
  connections: Counter;
  disconnects: Counter;
  joins: Counter;
  published: Counter;
  rooms: Counter;
  failures: Counter;
  duration: Histogram;
}

const DELIVERY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120];
const PUBLISH_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];
const handles = new WeakMap<RuntimeMonitor, Handles>();

function of(monitor: RuntimeMonitor): Handles {
  let h = handles.get(monitor);
  if (!h) {
    const r = monitor.metrics;
    h = {
      sockets: r.gauge('crm_realtime_sockets', 'Sockets connected to this API process'),
      roomsHeld: r.gauge(
        'crm_realtime_rooms',
        'Rooms held by this API process (one private room per socket included)',
      ),
      deliveryLag: r.histogram(
        'crm_realtime_delivery_lag_seconds',
        'Worst age of a realtime event on arrival at a browser over its last minute, as reported by the tab (estimate against the server clock)',
        DELIVERY_BUCKETS,
      ),
      connections: r.counter('crm_realtime_connections_total', 'Socket handshakes by outcome'),
      disconnects: r.counter('crm_realtime_disconnects_total', 'Sockets that disconnected'),
      joins: r.counter('crm_realtime_room_joins_total', 'Room join requests by result'),
      published: r.counter(
        'crm_realtime_events_published_total',
        'Realtime events published, by event type',
      ),
      rooms: r.counter(
        'crm_realtime_rooms_published_total',
        'Room deliveries the published events fanned out to',
      ),
      failures: r.counter(
        'crm_realtime_publish_failures_total',
        'Realtime publishes that failed, by event type',
      ),
      duration: r.histogram(
        'crm_realtime_publish_duration_seconds',
        'Time one publish took in the publisher: the sequence pipeline and the emit',
        PUBLISH_BUCKETS,
        { type: 'overflow' },
      ),
    };
    handles.set(monitor, h);
  }
  return h;
}

const use = (fn: (h: Handles) => void): void => {
  const monitor = getRuntimeMonitor();
  if (!monitor) return;
  try {
    fn(of(monitor));
  } catch {
    /* observability must never break the realtime path */
  }
};

export const realtimeMetrics = {
  setSockets: (n: number) => use((h) => h.sockets.set(n)),
  setRooms: (n: number) => use((h) => h.roomsHeld.set(n)),
  deliveryLag: (seconds: number) => use((h) => h.deliveryLag.observe(seconds, {})),
  connection: (outcome: 'accepted' | 'refused') => use((h) => h.connections.inc(1, { outcome })),
  disconnect: () => use((h) => h.disconnects.inc()),
  join: (result: 'ok' | 'forbidden' | 'limit' | 'invalid' | 'unavailable') =>
    use((h) => h.joins.inc(1, { result })),
  published: (type: string, rooms: number, seconds: number) =>
    use((h) => {
      h.published.inc(1, { type });
      h.rooms.inc(rooms);
      h.duration.observe(seconds, { type });
    }),
  publishFailed: (type: string) => use((h) => h.failures.inc(1, { type })),
};

/** What a connection remembers about its delivery reports (kept on `client.data`). */
export interface DeliveryReportState {
  lastDeliveryReportAt?: number;
}

/**
 * Decides whether a delivery report from one connection counts, and returns the lag in seconds to record, or null. A report must match
 * the contract (two bounded numbers), and one connection counts at most once per `REALTIME_DELIVERY_MIN_GAP_MS`, so a client that sends
 * them in a loop cannot skew the histogram or cost the server more than a parse.
 */
export function acceptDeliveryReport(
  body: unknown,
  state: DeliveryReportState,
  now: number,
): number | null {
  const parsed = realtimeDeliveryLagSchema.safeParse(body);
  if (!parsed.success) return null;
  if (
    state.lastDeliveryReportAt !== undefined &&
    now - state.lastDeliveryReportAt < REALTIME_DELIVERY_MIN_GAP_MS
  ) {
    return null;
  }
  state.lastDeliveryReportAt = now;
  return parsed.data.lagMs / 1000;
}
