import { describe, expect, it } from 'vitest';
import { flbFlowLinkProblems, flbFlowLinks, flbLinkableFlows } from '@crm/contracts';

const flows = [
  { id: 'wa-1', flowType: 'chat', isPublished: true },
  { id: 'wa-2', flowType: 'chat', isPublished: false },
  { id: 'web-1', flowType: 'web', isPublished: true },
  { id: 'ig-1', flowType: 'instagram', isPublished: true },
];
const sub = (id: string, flow: string) => ({ id, type: 'subflow', data: { flow } });
const buttons = (id: string, actions: Record<string, unknown>) => ({
  id,
  type: 'buttons',
  data: { optionActions: actions },
});

describe('flow links stay on one channel', () => {
  it('reads Run sub-flow steps and button "start another flow" actions, and skips unset pickers and other actions', () => {
    const links = flbFlowLinks([
      sub('a', 'wa-1'),
      sub('b', ' '),
      buttons('c', {
        '0': { type: 'flow', flow: 'web-1' },
        '1': { type: 'opt_in' },
        '2': { type: 'flow', flow: '' },
      }),
    ]);
    expect(links.map((l) => [l.nodeId, l.flowId])).toEqual([
      ['a', 'wa-1'],
      ['c', 'web-1'],
    ]);
  });

  it('offers only same-channel bots, never the bot itself', () => {
    expect(flbLinkableFlows(flows, 'chat', 'wa-1').map((f) => f.id)).toEqual(['wa-2']);
    expect(flbLinkableFlows(flows, 'web', null).map((f) => f.id)).toEqual(['web-1']);
  });

  it('flags a WhatsApp bot that starts a website chat bot (sub-flow and button), naming both channels', () => {
    const p = flbFlowLinkProblems(
      [sub('a', 'web-1'), buttons('b', { '0': { type: 'flow', flow: 'ig-1' } }), sub('ok', 'wa-2')],
      { channel: 'chat', selfId: 'wa-1', flows },
    );
    expect(p.map((x) => [x.nodeId, x.kind])).toEqual([
      ['a', 'channel'],
      ['b', 'channel'],
    ]);
    expect(p[0]!.message).toBe(
      'A WhatsApp bot cannot start a Website chat bot — pick a WhatsApp bot.',
    );
  });

  it('flags a bot that starts itself', () => {
    const p = flbFlowLinkProblems([sub('a', 'wa-1')], { channel: 'chat', selfId: 'wa-1', flows });
    expect(p.map((x) => x.kind)).toEqual(['self']);
  });

  it('a deleted target is only a problem when asked for (publish), not on a draft save', () => {
    const ctx = { channel: 'chat', selfId: 'wa-1', flows };
    expect(flbFlowLinkProblems([sub('a', 'gone')], ctx)).toEqual([]);
    expect(
      flbFlowLinkProblems([sub('a', 'gone')], ctx, { missing: true }).map((x) => x.kind),
    ).toEqual(['missing']);
  });

  it('an unpublished same-channel target is allowed', () => {
    expect(
      flbFlowLinkProblems(
        [sub('a', 'wa-2')],
        { channel: 'chat', selfId: 'wa-1', flows },
        { missing: true },
      ),
    ).toEqual([]);
  });
});
