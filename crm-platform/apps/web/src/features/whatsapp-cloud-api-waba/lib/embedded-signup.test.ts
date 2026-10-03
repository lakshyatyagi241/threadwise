import { describe, expect, it } from 'vitest';
import {
  initialSignup,
  isFacebookOrigin,
  nextSignup,
  parseSignupMessage,
  type SignupEvent,
  type SignupState,
} from './embedded-signup';

const run = (events: SignupEvent[], mode: 'standard' | 'coexistence' = 'standard') => {
  let state: SignupState = initialSignup(mode);
  const effects = events.map((ev) => {
    const r = nextSignup(state, ev);
    state = r.state;
    return r.effect;
  });
  return { state, effects };
};
const finish = (data: Record<string, unknown>, event = 'FINISH'): SignupEvent => ({
  type: 'session',
  event,
  data,
});
const ids = { waba_id: '111', phone_number_id: '222', business_id: '333' };

describe('embedded signup flow (TW-WABA-005)', () => {
  it('submits exactly once when code and session arrive, in either order', () => {
    for (const order of [
      [{ type: 'code', code: 'c' } as const, finish(ids)],
      [finish(ids), { type: 'code', code: 'c' } as const],
    ]) {
      const { effects } = run(order);
      expect(effects.filter((e) => e.kind === 'submit')).toHaveLength(1);
      expect(effects.find((e) => e.kind === 'submit')).toEqual({
        kind: 'submit',
        input: {
          code: 'c',
          wabaId: '111',
          phoneNumberId: '222',
          businessId: '333',
          coexistence: false,
        },
      });
    }
  });

  it('never double-posts when a repeated event arrives after the submit', () => {
    const { effects } = run([{ type: 'code', code: 'c' }, finish(ids), finish(ids)]);
    expect(effects.filter((e) => e.kind === 'submit')).toHaveLength(1);
  });

  it('standard mode waits for the number: a code and a WABA alone do not submit', () => {
    const { effects } = run([{ type: 'code', code: 'c' }, finish({ waba_id: '111' })]);
    expect(effects.every((e) => e.kind === 'none')).toBe(true);
  });

  it('FINISH_ONLY_WABA in standard mode asks the user to pick a number and posts nothing', () => {
    const { effects } = run([
      { type: 'code', code: 'c' },
      finish({ waba_id: '111' }, 'FINISH_ONLY_WABA'),
    ]);
    expect(effects[1]).toEqual({ kind: 'no-number' });
    expect(effects.some((e) => e.kind === 'submit')).toBe(false);
  });

  it('coexistence submits on the WABA alone with coexistence=true and no phone id', () => {
    const { effects } = run(
      [
        { type: 'code', code: 'c' },
        finish({ waba_id: '111' }, 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'),
      ],
      'coexistence',
    );
    expect(effects[1]).toEqual({
      kind: 'submit',
      input: { code: 'c', wabaId: '111', coexistence: true },
    });
  });

  it('a Business App onboarding event switches a standard launch into coexistence', () => {
    const { effects } = run([
      { type: 'code', code: 'c' },
      finish({ waba_id: '111' }, 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'),
    ]);
    expect(effects[1]).toMatchObject({ kind: 'submit', input: { coexistence: true } });
  });

  it('reports cancel and Meta errors without submitting', () => {
    expect(run([finish({}, 'CANCEL')]).effects[0]).toEqual({ kind: 'cancelled' });
    expect(run([finish({ error_message: 'boom' }, 'ERROR')]).effects[0]).toEqual({
      kind: 'error',
      message: 'boom',
    });
    expect(run([finish({}, 'ERROR')]).effects[0]).toEqual({ kind: 'error', message: null });
  });

  it('ignores events it does not know', () => {
    expect(run([finish(ids, 'SOMETHING_NEW')]).effects[0]).toEqual({ kind: 'none' });
  });

  it('accepts numeric ids from Meta by turning them into strings', () => {
    const { effects } = run([
      { type: 'code', code: 'c' },
      finish({ waba_id: 1, phone_number_id: 2 }),
    ]);
    expect(effects[1]).toMatchObject({
      kind: 'submit',
      input: { wabaId: '1', phoneNumberId: '2' },
    });
  });
});

describe('message parsing', () => {
  it('reads an object or JSON text, and nothing else', () => {
    const msg = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: ids };
    expect(parseSignupMessage(msg)).toEqual({ event: 'FINISH', data: ids });
    expect(parseSignupMessage(JSON.stringify(msg))).toEqual({ event: 'FINISH', data: ids });
    expect(parseSignupMessage({ type: 'other', event: 'FINISH' })).toBeNull();
    expect(parseSignupMessage('not json')).toBeNull();
    expect(parseSignupMessage(null)).toBeNull();
  });

  it('trusts facebook.com and its subdomains only', () => {
    expect(isFacebookOrigin('https://www.facebook.com')).toBe(true);
    expect(isFacebookOrigin('https://business.facebook.com')).toBe(true);
    expect(isFacebookOrigin('https://facebook.com')).toBe(true);
    expect(isFacebookOrigin('https://evilfacebook.com')).toBe(false);
    expect(isFacebookOrigin('https://facebook.com.evil.io')).toBe(false);
    expect(isFacebookOrigin('not a url')).toBe(false);
  });
});
