import { QueryClient } from '@tanstack/react-query';
import { prefItem, prefsOf } from '@/test/preferences-fixtures';
import { PreferenceSaver } from './preference-saver';
import {
  applyChange,
  changeRequest,
  preferencesKey,
  stateFromResponse,
  type PrefsState,
} from './preferences-model';

const turnPopupOff = (state: PrefsState) => {
  const next = applyChange(state, 'new_message', 'toast', false);
  return { next, request: changeRequest(next, 'new_message', 'toast') };
};

function setup(send: jest.Mock) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(preferencesKey, stateFromResponse(prefsOf(prefItem('new_message'))));
  const on = { fail: jest.fn(), busy: jest.fn(), clear: jest.fn() };
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  return { queryClient, on, invalidate, saver: new PreferenceSaver(queryClient, send, on) };
}
const toastOf = (queryClient: QueryClient) =>
  queryClient.getQueryData<PrefsState>(preferencesKey)!.entries[0]!.flags.toast;

describe('PreferenceSaver', () => {
  it('shows the change at once, sends it, and reads again when it is saved', async () => {
    const send = jest.fn().mockResolvedValue({});
    const { saver, queryClient, on, invalidate } = setup(send);
    expect(saver.run(turnPopupOff)).toBe(true);
    expect(toastOf(queryClient)).toBe(false);
    await saver.idle();
    expect(send).toHaveBeenCalledWith({ items: [{ type: 'new_message', toast: false }] });
    expect(on.busy).toHaveBeenLastCalledWith(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: preferencesKey });
  });

  it('puts the change back and says so when saving fails', async () => {
    const send = jest.fn().mockRejectedValue(new Error('x'));
    const { saver, queryClient, on } = setup(send);
    saver.run(turnPopupOff);
    await saver.idle();
    expect(toastOf(queryClient)).toBe(true);
    expect(on.fail).toHaveBeenCalled();
  });

  it('sends nothing when nothing changed or nothing is loaded', async () => {
    const send = jest.fn();
    const { saver } = setup(send);
    expect(saver.run((state) => ({ next: state, request: null }))).toBe(false);
    expect(
      new PreferenceSaver(new QueryClient(), send, {
        fail: jest.fn(),
        busy: jest.fn(),
        clear: jest.fn(),
      }).run(turnPopupOff),
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends changes one after another and reads again only after the last', async () => {
    const order: string[] = [];
    const send = jest.fn(async (r: { items: object[] }) => {
      order.push(JSON.stringify(r.items[0]));
    });
    const { saver, invalidate } = setup(send);
    saver.run(turnPopupOff);
    saver.run((state) => {
      const next = applyChange(state, 'new_message', 'sound', false);
      return { next, request: changeRequest(next, 'new_message', 'sound') };
    });
    await saver.idle();
    expect(order).toEqual([
      '{"type":"new_message","toast":false}',
      '{"type":"new_message","sound":false}',
    ]);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
