import { describe, expect, it } from 'vitest';
import type { ComposeSender, ComposeTemplate } from '@crm/contracts';
import { EMPTY_FORM } from './builder-model';
import {
  coerceForEngine,
  engineOf,
  isLimitedEngine,
  kindsFor,
  senderOf,
  templatesFor,
} from './engine-gate';

const sender = (key: string, o: Partial<ComposeSender> = {}): ComposeSender => ({
  key,
  label: key,
  phone: '',
  engine: key.split(':')[0]!,
  engineLabel: '',
  isDefault: false,
  ...o,
});
const tpl = (id: string, engine: string, senderLabel: string | null = null): ComposeTemplate =>
  ({ id, name: id, engine, senderLabel }) as unknown as ComposeTemplate;

const senders = [
  sender('baileys:1'),
  sender('waba:a', { label: '+91 1', isDefault: true }),
  sender('waba:b', { label: '+91 2' }),
];

describe('the sending number decides what a campaign can be', () => {
  it('reads the engine from the picked number, and none while no number is picked', () => {
    expect(engineOf('baileys:1')).toBe('baileys');
    expect(engineOf('waba:a')).toBe('waba');
    expect(engineOf('')).toBe('');
    expect(senderOf('', senders)).toBeUndefined();
    expect(senderOf('waba:a', senders)?.key).toBe('waba:a');
    expect(senderOf('waba:b', senders)?.label).toBe('+91 2');
  });

  it('shows every type and every template until a number is picked', () => {
    const all = [tpl('a', 'baileys'), tpl('b', 'waba'), tpl('d', 'twilio')];
    expect(kindsFor(engineOf(''))).toEqual(['custom', 'template', 'flow']);
    expect(templatesFor(all, engineOf(''), senderOf('', senders))).toHaveLength(3);
    expect(coerceForEngine({ ...EMPTY_FORM, type: 'custom' }, engineOf(''), all)).toEqual({});
  });

  it('a Meta number can only send a template; the others can send anything', () => {
    expect(kindsFor('waba')).toEqual(['template']);
    expect(kindsFor('baileys')).toEqual(['custom', 'template', 'flow']);
    expect(kindsFor('twilio')).toEqual(['custom', 'template', 'flow']);
    expect(kindsFor('')).toEqual(['custom', 'template', 'flow']);
  });

  it('Twilio and Meta numbers cannot carry buttons', () => {
    expect(isLimitedEngine('waba')).toBe(true);
    expect(isLimitedEngine('twilio')).toBe(true);
    expect(isLimitedEngine('baileys')).toBe(false);
  });

  it('shows only the templates of the number engine, and of that Meta number', () => {
    const all = [
      tpl('a', 'baileys'),
      tpl('b', 'waba', '+91 1'),
      tpl('c', 'waba', '+91 2'),
      tpl('d', 'twilio'),
      tpl('e', 'waba'),
    ];
    expect(templatesFor(all, 'baileys', senders[0]).map((t) => t.id)).toEqual(['a']);
    expect(templatesFor(all, 'waba', senders[1]).map((t) => t.id)).toEqual(['b', 'e']);
    expect(templatesFor(all, 'waba', senders[2]).map((t) => t.id)).toEqual(['c', 'e']);
    expect(templatesFor(all, 'twilio', undefined).map((t) => t.id)).toEqual(['d']);
    expect(templatesFor(all, '', undefined)).toHaveLength(5);
  });
});

describe('what a form is forced to when the number cannot send it', () => {
  const form = { ...EMPTY_FORM, type: 'custom' as const };

  it('turns a custom message or flow into a template on a Meta number', () => {
    expect(coerceForEngine(form, 'waba', [])).toEqual({ type: 'template' });
    expect(coerceForEngine({ ...form, type: 'flow' }, 'waba', [])).toEqual({ type: 'template' });
    expect(coerceForEngine({ ...form, type: 'template' }, 'waba', [])).toEqual({});
  });

  it('leaves a custom message alone on the unofficial engine', () => {
    expect(coerceForEngine(form, 'baileys', [])).toEqual({});
  });

  it('drops a template, and its values, that the number cannot use', () => {
    const f = { ...form, type: 'template' as const, templateId: 'x', templateOverrides: { a: 1 } };
    expect(coerceForEngine(f, 'baileys', [tpl('y', 'baileys')])).toEqual({
      templateId: '',
      templateOverrides: null,
    });
    expect(coerceForEngine(f, 'baileys', [tpl('x', 'baileys')])).toEqual({});
  });

  it('drops buttons on Meta and Twilio only', () => {
    const f = { ...form, buttons: [{ type: 'url' as const, text: 'Go', value: 'https://x.test' }] };
    expect(coerceForEngine(f, 'twilio', [])).toEqual({ buttons: [] });
    expect(coerceForEngine(f, 'baileys', [])).toEqual({});
  });
});
