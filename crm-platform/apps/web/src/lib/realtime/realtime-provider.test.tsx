import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { REALTIME_EVENT } from '@crm/contracts';
import { fakeSocketFactory } from './fake-socket';
import { useRealtimeEvent, useRealtimeStatus, useResync, useRoom } from './hooks';
import { RealtimeProvider, useRealtimeClient } from './realtime-provider';

const CONV = '33333333-3333-4333-8333-333333333333';

/** Uses every hook, the way a screen would, and shows what they report. */
function Probe() {
  const status = useRealtimeStatus();
  const room = useRoom({ kind: 'conv', id: CONV });
  const none = useRoom(null);
  const client = useRealtimeClient();
  useRealtimeEvent(REALTIME_EVENT.unread, () => undefined);
  useResync(() => undefined, ['user']);
  return (
    <p>
      status={status} room={room.state} none={none.state} client={client ? 'yes' : 'no'}
    </p>
  );
}

describe('RealtimeProvider: server rendering', () => {
  it('renders its children and touches no socket, no ticket and no window', () => {
    const { factory, sockets } = fakeSocketFactory();
    const mintTicket = vi.fn(async () => 'rtk_x');
    const html = renderToString(
      <RealtimeProvider
        url="http://api.test/realtime"
        createSocket={factory}
        mintTicket={mintTicket}
      >
        <span>page</span>
      </RealtimeProvider>,
    );
    expect(html).toContain('page');
    expect(sockets).toHaveLength(0);
    expect(mintTicket).not.toHaveBeenCalled();
  });

  it('every hook is inert during the server render: idle, no client, nothing joined', () => {
    const { factory, sockets } = fakeSocketFactory();
    const html = renderToString(
      <RealtimeProvider url="http://api.test/realtime" createSocket={factory}>
        <Probe />
      </RealtimeProvider>,
    );
    expect(html.replace(/<!-- -->/g, '')).toContain('status=idle room=idle none=idle client=no');
    expect(sockets).toHaveLength(0);
  });

  it('works without a provider (a page outside the app layout) and without a url', () => {
    expect(renderToString(<Probe />).replace(/<!-- -->/g, '')).toContain(
      'status=idle room=idle none=idle client=no',
    );
    expect(
      renderToString(
        <RealtimeProvider>
          <Probe />
        </RealtimeProvider>,
      ).replace(/<!-- -->/g, ''),
    ).toContain('status=idle');
  });
});
