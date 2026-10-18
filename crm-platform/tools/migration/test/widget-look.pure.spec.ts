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
