import { describe, expect, it } from 'vitest';
import {
  buttonActionIncomplete,
  buttonActionOf,
  buttonActionPatch,
  buttonActionsWithout,
} from './button-actions';

describe('button pressed actions', () => {
  it('reads what a button does: nothing, a hand-over, or an action', () => {
    const d = {
      handoffs: { '0': { team: 't1', message: 'hi' } },
      optionActions: { '1': { type: 'opt_out' }, '2': { type: 'flow', flow: 'F' } },
    };
    expect(buttonActionOf(d, 0)).toEqual({ kind: 'live_agent', team: 't1', message: 'hi' });
    expect(buttonActionOf(d, 1)).toEqual({ kind: 'opt_out' });
    expect(buttonActionOf(d, 2)).toEqual({ kind: 'flow', flow: 'F' });
    expect(buttonActionOf(d, 3)).toEqual({ kind: 'none' });
    expect(buttonActionOf({}, 0)).toEqual({ kind: 'none' });
  });

  it('a button has one action: choosing another removes the previous one, and "none" clears it', () => {
    const d = {
      handoffs: { '0': { team: 't', message: '' } },
      optionActions: { '1': { type: 'opt_in' } },
    };
    const toFlow = buttonActionPatch(d, 0, { kind: 'flow', flow: 'F' });
    expect(toFlow.handoffs).toEqual({});
    expect(toFlow.optionActions).toEqual({
      '0': { type: 'flow', flow: 'F' },
      '1': { type: 'opt_in' },
    });
    const toAgent = buttonActionPatch(d, 1, { kind: 'live_agent', team: 'x', message: 'n' });
    expect(toAgent.optionActions).toEqual({});
    expect(toAgent.handoffs).toEqual({
      '0': { team: 't', message: '' },
      '1': { team: 'x', message: 'n' },
    });
    expect(buttonActionPatch(d, 0, { kind: 'none' }).handoffs).toEqual({});
  });

  it('removing a button drops its action and moves the later ones up', () => {
    const d = {
      handoffs: { '0': { team: 'a', message: '' }, '2': { team: 'c', message: '' } },
      optionActions: { '1': { type: 'opt_out' } },
    };
    expect(buttonActionsWithout(d, 1)).toEqual({
      handoffs: { '0': { team: 'a', message: '' }, '1': { team: 'c', message: '' } },
      optionActions: {},
    });
  });

  it('a flow action without a flow, or a hand-over without a team, is not finished', () => {
    expect(buttonActionIncomplete({ kind: 'flow', flow: ' ' })).toBe(true);
    expect(buttonActionIncomplete({ kind: 'flow', flow: 'F' })).toBe(false);
    expect(buttonActionIncomplete({ kind: 'live_agent', team: '', message: '' })).toBe(true);
    expect(buttonActionIncomplete({ kind: 'opt_out' })).toBe(false);
  });
});
