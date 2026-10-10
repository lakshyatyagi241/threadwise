import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXPO_PUSH_ENDPOINT_PREFIX, type PushPayload } from '@crm/contracts';
import { WebPushSender } from '../../../src/modules/notifications/web-push.sender';
import type { PushTarget } from '../../../src/modules/notifications/push-subscriptions.repository';

const expo = (id: number, token: string): PushTarget => ({
  id,
  uuid: `00000000-0000-4000-8000-00000000000${id}`,
  endpoint: `${EXPO_PUSH_ENDPOINT_PREFIX}ExponentPushToken[${token}]`,
  p256dh: 'expo-mobile',
  auth: 'expo-mobile',
  failureCount: 0,
});

const payload: PushPayload = {
  v: 1,
  title: 'New message from Asha',
  body: 'Is it shipped?',
  tag: 'msg:abc',
  url: '/inbox?c=22222222-2222-4222-8222-222222222222',
  silent: false,
  notificationId: null,
};

/** A sender whose browser provider is OFF (no VAPID keys): native devices must still be delivered. */
const sender = () =>
  new WebPushSender({ isEnabled: () => false, send: vi.fn() } as never, {} as never, {} as never);

afterEach(() => vi.restoreAllMocks());

describe('native (Expo) push delivery', () => {
  it('sends one batch and maps ok / DeviceNotRegistered / other errors per device', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { status: 'ok' },
            { status: 'error', details: { error: 'DeviceNotRegistered' } },
            { status: 'error', details: { error: 'MessageRateExceeded' } },
          ],
        }),
        { status: 200 },
      ),
    );
    const report = await sender().send([expo(1, 'a'), expo(2, 'b'), expo(3, 'c')], payload, 'new_message');
    expect(report).toMatchObject({ sent: [1], gone: [2], refused: [3], retry: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(sentBody).toHaveLength(3);
    expect(sentBody[0]).toMatchObject({ to: 'ExponentPushToken[a]', title: payload.title, priority: 'high', data: { url: payload.url } });
  });

  it('retries every device on a 5xx or a network error, and never throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 }));
    expect((await sender().send([expo(1, 'a')], payload)).retry).toEqual([1]);
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    expect((await sender().send([expo(2, 'b')], payload)).retry).toEqual([2]);
  });

  it('leaves browser devices alone when VAPID is off, and does not call Expo without native devices', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const web: PushTarget = { ...expo(9, 'x'), endpoint: 'https://push.example.test/9/secret' };
    const report = await sender().send([web], payload);
    expect(report).toEqual({ sent: [], gone: [], refused: [], retry: [], unusable: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
