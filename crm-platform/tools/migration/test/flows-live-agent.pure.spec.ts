import { describe, expect, it } from 'vitest';
import { waboToGraph } from '../flows/wabo-convert';
import { FLOW_CONSTANTS } from '../transform/flows';

describe('a Waboo live-agent button becomes the Human handoff node', () => {
  const records = [
    { nodeId: 'a1', qid: 'q', subType: 'text', displayOrder: 0, response: [{ value: 'hi' }] },
    {
      nodeId: 'a2',
      qid: 'q',
      subType: 'interactive-message',
      displayOrder: 1,
      response: [
        {
          interactive: {
            action: {
              buttons: [{ type: 'live_agent', id: 'agent-0001-xxxx', value: { text: 'Talk to agent' } }],
            },
          },
        },
      ],
    },
  ];

  it('the assign node carries handoff: 2 and the customer_asked reason (without it the node is the old Assign agent)', () => {
    const out = waboToGraph(records, { exact: true });
    const agent = out.graph.flowNodes.find((n) => n.type === 'assign');
    expect(agent).toBeDefined();
    expect(agent!.data).toMatchObject({ handoff: 2, destination: 'team', reason: 'customer_asked' });
  });

  it('every migrated flow is written with the Advanced builder', () => {
    expect(FLOW_CONSTANTS.builder).toBe('advanced');
  });
});
