import { describe, expect, it } from 'vitest';
import { launcherLook } from '../flows/widget';
import { buildFaqDocs } from '../flows/faq';
import type { Soft } from '../transform/types';
import type { Doc } from '../util';

const look = (c: Doc, t: Doc = {}) => {
  const soft: Soft[] = [];
  return { ...launcherLook(c, t, soft), soft };
};

describe('launcherLook: the migrated button opens as it was at the source', () => {
  it('keeps an icon button, a bounce and a popup that is switched off', () => {
    const r = look({
      widget_animation: 'Bounce',
      button_type: 'icon',
      tooltip: { enabled: false, position: 'Top' },
    });
    expect(r.buttonType).toBe('icon');
    expect(r.animation).toBe('bounce');
    expect(r.popup).toEqual({ enabled: false, position: 'top' });
    expect(r.soft).toEqual([]);
  });

  it('reads the theme button type and object-shaped settings', () => {
    const r = look(
      { widget_animation: { type: 'ripple' } },
      { button: { button_type: { type: 'Chat with us' } } },
    );
    expect(r.buttonType).toBe('pill');
    expect(r.animation).toBe('ripple');
  });

  it('a popup the source does not mention stays OFF, and an unknown value is reported, never guessed', () => {
    const r = look({
      widget_animation: 'wobble',
      tooltip: { enabled: true, position: 'diagonal' },
    });
    expect(r.popup.enabled).toBe(true);
    expect(r.animation).toBeNull();
    expect(r.soft[0]).toMatchObject({
      code: 'LAUNCHER_LOOK_UNRECOGNISED',
      detail: ['widget_animation', 'tooltip.position'],
    });
    expect(look({}).popup).toEqual({ enabled: false });
  });
});

describe('FAQs made from Intent records are named', () => {
  const owner = () => ({ ok: true as const });
  const base = { botid: 'b', response: undefined, journey: { qid: 'j' } };
  it('flags an Intent-only question and not an FAQ record', () => {
    const docs = buildFaqDocs({
      workspace: [
        { ...base, _id: 1, qid: 'j', type: 'Intent', question: 'hello' },
        {
          ...base,
          _id: 2,
          qid: 'f',
          type: 'FAQ',
          question: 'Feedback',
          response: [{ type: 'text', value: 'Thanks' }],
        },
      ] as unknown as Doc[],
      variations: [],
      owner,
    });
    const codes = (q: string) => docs.find((d) => d.question === q)!.soft.map((s) => s.code);
    expect(codes('hello')).toContain('INTENT_ONLY');
    expect(codes('Feedback')).not.toContain('INTENT_ONLY');
  });
});

describe('fallbackOf: the fallback message is carried exactly', () => {
  it('keeps spelling, spacing and punctuation, from the usual places', async () => {
    const { fallbackOf } = await import('../flows/widget');
    const soft: Soft[] = [];
    const msg = 'Sorry,  i didnt get that!! ';
    expect(fallbackOf({ fallback_message: msg }, {}, soft)).toBe(msg);
    expect(fallbackOf({ default_messages: { fallback: msg } }, {}, soft)).toBe(msg);
    expect(fallbackOf({}, { fallback_message: msg }, soft)).toBe(msg);
    expect(fallbackOf({ fallback_message: '  ' }, {}, soft)).toBeNull();
    expect(soft).toEqual([]);
  });

  it('does not cut a text the application cannot hold; it says so', async () => {
    const { fallbackOf } = await import('../flows/widget');
    const soft: Soft[] = [];
    expect(fallbackOf({ fallback_message: 'x'.repeat(1025) }, {}, soft)).toBeNull();
    expect(soft[0]).toMatchObject({ code: 'FALLBACK_TOO_LONG', detail: 1025 });
  });
});

describe('chatSettingsOf: feedback, languages and devices keep their flags and stored values', () => {
  it('keeps a disabled feedback with its stored message, English primary and no extra languages', async () => {
    const { chatSettingsOf } = await import('../flows/widget');
    const soft: Soft[] = [];
    const r = chatSettingsOf(
      {
        feedback: { enabled: false, message: 'How did we do?' },
        devices: { desktop: true, tablet: true, mobile: true },
      },
      { primary_language: 'English' },
      soft,
    );
    expect(r.feedback).toEqual({ enabled: false, message: 'How did we do?' });
    expect(r.languages).toEqual({ primary: 'en' });
    expect(r.devices).toEqual({ desktop: true, tablet: true, mobile: true });
    expect(soft).toEqual([]);
  });

  it('states nothing it does not find, and reports a value it cannot carry', async () => {
    const { chatSettingsOf } = await import('../flows/widget');
    const soft: Soft[] = [];
    expect(chatSettingsOf({}, {}, soft)).toEqual({});
    const r = chatSettingsOf(
      { feedback_message: 'x'.repeat(201) },
      { primary_language: 'Klingon!' },
      soft,
    );
    expect(r.feedback).toBeUndefined();
    expect(soft[0]).toMatchObject({ code: 'CHAT_SETTING_UNRECOGNISED' });
  });
});
