import { describe, expect, it } from 'vitest';
import type { ComposeSender, ComposeTemplate } from '@crm/contracts';
import { EMPTY_FORM } from './builder-model';
import {
  coerceForEngine,
  engineOf,
  isEmailEngine,
  isLimitedEngine,
  isSmsEngine,
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

  it('an SMS number sends a custom text or a template, never a flow', () => {
    expect(kindsFor('sms')).toEqual(['custom', 'template']);
    expect(isSmsEngine('sms')).toBe(true);
    expect(isSmsEngine('twilio')).toBe(false);
    expect(engineOf('sms:5d1b')).toBe('sms');
  });

  it('Twilio, SMS and Meta numbers cannot carry buttons', () => {
    expect(isLimitedEngine('waba')).toBe(true);
    expect(isLimitedEngine('twilio')).toBe(true);
    expect(isLimitedEngine('sms')).toBe(true);
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

  it('turns a flow into a custom text and clears what a text cannot carry on an SMS number', () => {
    const f = {
      ...form,
      type: 'flow' as const,
      flowId: 'f1',
      customHeader: 'Hi',
      customFooter: 'Bye',
      mediaUrl: 'https://x.test/a.png',
      abTesting: true,
      buttons: [{ type: 'url' as const, text: 'Go', value: 'https://x.test' }],
    };
    expect(coerceForEngine(f, 'sms', [])).toEqual({
      type: 'custom',
      buttons: [],
      customHeader: '',
      customFooter: '',
      mediaUrl: '',
      abTesting: false,
      flowId: '',
    });
    expect(coerceForEngine(form, 'sms', [])).toEqual({});
  });

  it('drops buttons on Meta and Twilio only', () => {
    const f = { ...form, buttons: [{ type: 'url' as const, text: 'Go', value: 'https://x.test' }] };
    expect(coerceForEngine(f, 'twilio', [])).toEqual({ buttons: [] });
    expect(coerceForEngine(f, 'baileys', [])).toEqual({});
  });
});

describe('an email sender (a connected mailbox)', () => {
  const mail = {
    ...EMPTY_FORM,
    senderKey: 'email:5d1b',
    type: 'custom' as const,
    customHeader: 'Your May offer is live',
    customMessage: 'Hello',
  };

  it('reads the engine from the key and sends a typed message only', () => {
    expect(engineOf('email:5d1b')).toBe('email');
    expect(isEmailEngine('email')).toBe(true);
    expect(isEmailEngine('sms')).toBe(false);
    expect(kindsFor('email')).toEqual(['custom']);
    // Email is not one of the "limited" WhatsApp-style engines; it hides its own parts.
    expect(isLimitedEngine('email')).toBe(false);
  });

  it('keeps a complete email form as it is (the subject is the Header field)', () => {
    expect(coerceForEngine(mail, 'email', [])).toEqual({ trackingEnabled: false });
    expect(coerceForEngine({ ...mail, type: 'text' }, 'email', [])).toEqual({
      trackingEnabled: false,
    });
  });

  it('turns a template or flow into a custom message and clears everything a mail cannot carry', () => {
    const f = {
      ...mail,
      type: 'template' as const,
      templateId: 't1',
      templateIdB: 't2',
      templateOverrides: { a: 1 },
      templateOverridesB: { b: 1 },
      flowId: 'f1',
      flowIdB: 'f2',
      abTesting: true,
      customMessageB: 'B',
      mediaUrl: 'https://x.test/a.png',
      customFooter: 'Bye',
      buttons: [{ type: 'url' as const, text: 'Go', value: 'https://x.test' }],
      throttleMinSec: '1',
      throttleMaxSec: '2',
      batchSize: '10',
      batchPauseMin: '5',
      dailyLimit: '100',
      windowStart: '09:00',
      windowEnd: '18:00',
    };
    expect(coerceForEngine(f, 'email', [{ id: 't1' } as ComposeTemplate])).toEqual({
      type: 'custom',
      templateId: '',
      templateIdB: '',
      templateOverrides: null,
      templateOverridesB: null,
      flowId: '',
      flowIdB: '',
      abTesting: false,
      customMessageB: '',
      mediaUrl: '',
      customFooter: '',
      buttons: [],
      trackingEnabled: false,
      throttleMinSec: '',
      throttleMaxSec: '',
      batchSize: '',
      batchPauseMin: '',
      dailyLimit: '',
      windowStart: '',
      windowEnd: '',
    });
  });

  it('cuts a subject longer than 150 and leaves SMS and WhatsApp forms unchanged', () => {
    const long = 'x'.repeat(200);
    expect(coerceForEngine({ ...mail, customHeader: long }, 'email', []).customHeader).toHaveLength(
      150,
    );
    // The same fields on a Baileys number are left alone.
    expect(
      coerceForEngine({ ...mail, customHeader: long, batchSize: '10' }, 'baileys', []),
    ).toEqual({});
  });
});
