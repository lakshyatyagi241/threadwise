import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, HANDOFF_PORTS, HANDOFF_RETURNED_PORT, flbHandleToPort } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import { customerOutcomeOf } from '../../../src/modules/flow-runtime-engine/triggers/handoff-return.consumer';

/**
 * Return to bot (BL-410): the Human handoff step's optional fourth exit reaches the runtime as port 4, the one number no handoff outcome
 * ever takes, and the refusals of the outbound path are told apart for the staff line.
 */
describe('the returned exit in the runtime graph', () => {
  const builder = {
    flowNodes: [
      { id: 't', type: 'trigger', data: {}, isStart: true },
      { id: 'h', type: 'assign', data: { handoff: 2, destination: 'rules' } },
      { id: 'ok', type: 'message', data: { text: 'assigned' } },
      { id: 'back', type: 'message', data: { text: 'welcome back' } },
    ],
    flowEdges: [
      { source: 't', sourceHandle: 'out', target: 'h' },
      { source: 'h', sourceHandle: 'assigned', target: 'ok' },
      { source: 'h', sourceHandle: 'returned', target: 'back' },
    ],
    vars: {},
  };

  it('leaves by port 4; the three outcomes keep 1, 2, 3; the editor and the runtime agree', () => {
    const g = compileGraph(builder);
    expect(g.edges).toContainEqual({ from: 'h_4', to: 'back' });
    expect(g.edges).toContainEqual({ from: 'h_1', to: 'ok' });
    expect(Object.values(HANDOFF_PORTS)).not.toContain(HANDOFF_RETURNED_PORT);
    expect(flbHandleToPort('assign', 'returned')).toBe(HANDOFF_RETURNED_PORT);
  });

  it('a flow with no returned wire compiles exactly as before (no port 4 edge)', () => {
    const g = compileGraph({
      ...builder,
      flowEdges: builder.flowEdges.filter((e) => e.sourceHandle !== 'returned'),
    });
    expect(g.edges.some((e) => e.from === 'h_4')).toBe(false);
  });
});

describe('what stopped the message to the customer', () => {
  const refused = (code: keyof typeof ERROR_CODES | string) =>
    new AppError(code as never, 'x', HttpStatus.UNPROCESSABLE_ENTITY);

  it('names the closed window, the missing consent, the unavailable channel, and anything else as failed', () => {
    expect(customerOutcomeOf(refused(ERROR_CODES.SERVICE_WINDOW_CLOSED))).toBe('window_closed');
    expect(customerOutcomeOf(refused(ERROR_CODES.CONSENT_OPTED_OUT))).toBe('no_consent');
    expect(customerOutcomeOf(refused('CHANNEL_DISCONNECTED'))).toBe('channel_unavailable');
    expect(customerOutcomeOf(refused('PLAN_LIMIT_REACHED'))).toBe('failed');
    expect(customerOutcomeOf(new Error('boom'))).toBe('failed');
  });
});
