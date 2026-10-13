import { describe, expect, it, vi } from 'vitest';
import { CloudGroupThreadReader } from '../../../src/modules/chat-conversations/cloud-group-thread.reader';

/**
 * What the composer of a Meta Cloud API group thread is told (docs/specs/waba-groups-management.md 12, D8, D10): off for a plan without
 * Groups, a suspended group or a number last probed as not eligible; on with the member count and a cost estimate otherwise; a short
 * wallet warns without switching the composer off.
 */
const GROUP = 'g:Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2';
const cloud = { id: 3, kind: 'whatsapp_cloud' };

function build(
  o: {
    row?: Record<string, unknown> | undefined;
    plan?: boolean;
    cache?: string | null | Error;
    quote?: { estimateMinor: number | null; currency: string; covered: boolean } | null;
  } = {},
) {
  const row =
    'row' in o
      ? o.row
      : {
          config_id: 11,
          subject: 'Neighbours',
          suspended: false,
          participant_count: 8,
          found: true,
        };
  const tx = { execute: vi.fn(async () => ({ rows: row ? [row] : [] })) };
  const plans = { featureEnabled: vi.fn(async () => o.plan ?? true) };
  const quote = vi.fn(async () =>
    'quote' in o ? o.quote : { estimateMinor: 640, currency: 'USD', covered: true },
  );
  const redis = {
    get: vi.fn(async () => {
      if (o.cache instanceof Error) throw o.cache;
      return o.cache ?? null;
    }),
  };
  const reader = new CloudGroupThreadReader(plans as never, { quote } as never, redis as never);
  return {
    reader,
    tx,
    plans,
    quote,
    redis,
    state: () => reader.stateOf(tx as never, 7, cloud, GROUP),
  };
}

describe('CloudGroupThreadReader.stateOf', () => {
  it('is on for an active group: the member count and an estimate for one message to every member', async () => {
    const x = build();
    const s = await x.state();
    expect(s).toEqual({
      groupId: 'Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2',
      subject: 'Neighbours',
      memberCount: 8,
      suspended: false,
      block: null,
      canSend: true,
      estimate: { minor: 640, currency: 'USD' },
      walletShort: false,
    });
    expect(x.quote).toHaveBeenCalledWith({ orgId: 7, source: 'group_message', recipients: 8 });
    expect(x.plans.featureEnabled).toHaveBeenCalledWith(7, 'waba_groups');
  });

  it('warns about a short wallet without switching the composer off', async () => {
    const s = await build({
      quote: { estimateMinor: 640, currency: 'USD', covered: false },
    }).state();
    expect(s).toMatchObject({ canSend: true, block: null, walletShort: true });
  });

  it('is off for a suspended group, with no estimate and no wallet read', async () => {
    const x = build({
      row: { config_id: 11, subject: 'S', suspended: true, participant_count: 8, found: true },
    });
    expect(await x.state()).toMatchObject({
      suspended: true,
      block: 'suspended',
      canSend: false,
      estimate: null,
    });
    expect(x.quote).not.toHaveBeenCalled();
  });

  it('is off, as "plan", when the plan has no Groups (before anything else is judged)', async () => {
    const x = build({
      plan: false,
      row: { config_id: 11, subject: 'S', suspended: true, participant_count: 8, found: true },
    });
    expect(await x.state()).toMatchObject({ block: 'plan', canSend: false, estimate: null });
    expect(x.quote).not.toHaveBeenCalled();
  });

  it('is off for a number the Groups screen last probed as not eligible; a cache miss or a Redis error is unknown, not a no', async () => {
    expect(await build({ cache: '0' }).state()).toMatchObject({
      block: 'ineligible',
      canSend: false,
    });
    expect(await build({ cache: '1' }).state()).toMatchObject({ block: null, canSend: true });
    expect(await build({ cache: null }).state()).toMatchObject({ block: null });
    expect(await build({ cache: new Error('down') }).state()).toMatchObject({ block: null });
  });

  it('prices one recipient while Meta has not told us the size, and shows no estimate when none can be worked out', async () => {
    const x = build({ row: undefined, quote: null });
    expect(await x.state()).toMatchObject({
      memberCount: 0,
      subject: null,
      estimate: null,
      walletShort: false,
      canSend: true,
    });
    expect(x.quote).toHaveBeenCalledWith({ orgId: 7, source: 'group_message', recipients: 1 });
  });

  it('answers null for a phone thread and for any channel that is not the Cloud API', async () => {
    const x = build();
    expect(await x.reader.stateOf(x.tx as never, 7, cloud, '919900000050')).toBeNull();
    expect(
      await x.reader.stateOf(x.tx as never, 7, { id: 3, kind: 'whatsapp_qr' }, GROUP),
    ).toBeNull();
    expect(x.tx.execute).not.toHaveBeenCalled();
  });
});
