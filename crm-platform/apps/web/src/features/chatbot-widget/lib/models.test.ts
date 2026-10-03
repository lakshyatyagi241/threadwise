import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canJump,
  firstProblem,
  intakeSummary,
  newState,
  previewImageUrl,
  snippetFor,
  swatchValue,
  toPayload,
  validateStep,
} from './builder-model';
import { accentFor, matchesSearch, relativeShort, statCards } from './list-model';
import { countryOf, dialCodeOf, nationalDigits, splitInternational } from './phone';

const valid = () => ({ ...newState(), mode: 'ai' as const, name: 'Pricing', assistantId: 'a-1' });

describe('builder defaults and payload (WD-WGT-002 rule 1)', () => {
  it('a new widget opens on the builder defaults', () => {
    const s = newState();
    expect(s).toMatchObject({
      mode: 'whatsapp',
      position: 'bottom_right',
      buttonColor: '#075E54',
      headerTitle: 'Chat with us',
      welcomeMessage: 'Hi! How can we help today?',
      messageBubbleColor: '#FFFFFF',
      messageTextColor: '#222222',
      bodyBgKind: 'color',
      bodyBgColor: '#ECE5DD',
      autoOpen: false,
      buttonLabel: 'Send message',
      collectName: true,
      collectEmail: false,
      collectPhone: false,
      prefilledMessage: "Hi, I'd like to know more.",
    });
  });

  it('the payload turns empty text into null and never carries the allow-list', () => {
    const p = toPayload({
      ...valid(),
      assistantId: '',
      buttonImageUrl: ' ',
      targetWhatsappNumber: '',
    });
    expect(p.assistantId).toBeNull();
    expect(p.buttonImageUrl).toBeNull();
    expect(p.targetWhatsappNumber).toBeNull();
    expect('allowedDomains' in p).toBe(false);
  });
});

describe('step rules (WD-WGT-002 validators)', () => {
  it('step 1: name, then agent for ai/both, then 8 digits of number for whatsapp/both', () => {
    expect(validateStep(1, { ...newState(), name: '  ' })).toMatchObject({
      ok: false,
      key: 'name',
    });
    expect(validateStep(1, { ...newState(), mode: 'ai', name: 'x' })).toMatchObject({
      ok: false,
      key: 'assistant',
      field: 'assistantId',
    });
    expect(validateStep(1, { ...valid(), mode: 'both' })).toMatchObject({
      ok: false,
      key: 'whatsapp',
      field: 'phone',
    });
    expect(
      validateStep(1, {
        ...valid(),
        mode: 'whatsapp',
        assistantId: '',
        targetWhatsappCc: '+91',
        targetWhatsappNumber: '12345',
      }),
    ).toMatchObject({ ok: false, key: 'whatsapp' });
    expect(
      validateStep(1, {
        ...valid(),
        mode: 'whatsapp',
        targetWhatsappCc: '+91',
        targetWhatsappNumber: '9876543210',
      }),
    ).toEqual({ ok: true });
    expect(
      validateStep(1, {
        ...valid(),
        mode: 'whatsapp',
        targetWhatsappCc: '+1',
        targetWhatsappNumber: '2345678',
      }),
    ).toEqual({ ok: true });
    expect(validateStep(1, valid())).toEqual({ ok: true });
  });

  it('step 2: the launcher fill must be #hex of 3 to 8 digits; the title is required', () => {
    for (const bad of ['red', '#12', '#123456789', '075E54', '']) {
      expect(validateStep(2, { ...valid(), buttonColor: bad })).toMatchObject({
        ok: false,
        key: 'launcherColour',
      });
    }
    for (const good of ['#abc', '#075E54', '#075E54FF', '#1234567']) {
      expect(validateStep(2, { ...valid(), buttonColor: good })).toEqual({ ok: true });
    }
    expect(validateStep(2, { ...valid(), headerTitle: ' ' })).toMatchObject({
      ok: false,
      key: 'headerTitle',
    });
  });

  it('step 3: the opening line is required; the tile image needs an address', () => {
    expect(validateStep(3, { ...valid(), welcomeMessage: '' })).toMatchObject({
      ok: false,
      key: 'welcome',
    });
    expect(validateStep(3, { ...valid(), bodyBgKind: 'image', bodyBgImageUrl: '' })).toMatchObject({
      ok: false,
      key: 'bgImage',
    });
    expect(
      validateStep(3, {
        ...valid(),
        bodyBgKind: 'image',
        bodyBgImageUrl: 'https://x.example/a.png',
      }),
    ).toEqual({ ok: true });
  });

  it('step 4 has no rules', () => {
    expect(validateStep(4, newState())).toEqual({ ok: true });
  });

  it('save and launch walk every step in order and report the first that fails', () => {
    expect(firstProblem(valid())).toBeNull();
    expect(firstProblem({ ...valid(), bodyBgKind: 'image', bodyBgImageUrl: '' })?.step).toBe(3);
    expect(firstProblem({ ...valid(), buttonColor: 'x', welcomeMessage: '' })?.step).toBe(2);
    expect(firstProblem({ ...newState() })?.step).toBe(1);
  });

  it('the stepper: back and reached steps are free, forward is gated', () => {
    expect(canJump(1, 3, 3)).toBe('free');
    expect(canJump(3, 1, 3)).toBe('free');
    expect(canJump(4, 1, 1)).toBe('gate');
    expect(canJump(2, 1, 4)).toBe('free');
  });
});

describe('preview helpers (WD-WGT-002, 004, 005)', () => {
  it('intake lists the enabled fields; none gives an empty list', () => {
    expect(
      intakeSummary({ collectName: true, collectEmail: true, collectPhone: false }).join(' + '),
    ).toBe('name + email');
    expect(intakeSummary({ collectName: false, collectEmail: false, collectPhone: false })).toEqual(
      [],
    );
  });

  it('the swatch accepts short hex and falls back to black for anything else', () => {
    expect(swatchValue('#abc')).toBe('#aabbcc');
    expect(swatchValue('#075E54')).toBe('#075e54');
    expect(swatchValue('#075E54FF')).toBe('#075e54');
    expect(swatchValue('red')).toBe('#000000');
  });

  it('WD-WGT-004 #1: only http(s) background images are used; quotes and brackets are encoded', () => {
    expect(previewImageUrl('javascript:alert(1)')).toBeNull();
    expect(previewImageUrl('not a url')).toBeNull();
    expect(previewImageUrl('https://x.example/a.png')).toBe('https://x.example/a.png');
    expect(previewImageUrl("https://x.example/a'b(c).png")).not.toMatch(/['()]/);
  });

  it('WD-WGT-007: the snippet is a deferred script tag with the embed address', () => {
    expect(snippetFor('https://crm.example/widget/T/embed')).toBe(
      '<script defer src="https://crm.example/widget/T/embed"></script>',
    );
  });
});

describe('list numbers (WD-WGT-001)', () => {
  it('visitors per widget to one decimal, health as a percentage and a word', () => {
    expect(statCards({ total: 0, active: 0, visitors: 0 })).toMatchObject({
      avgPerWidget: '0',
      healthPct: 0,
      health: 'empty',
      paused: 0,
    });
    expect(statCards({ total: 3, active: 3, visitors: 10 })).toMatchObject({
      avgPerWidget: '3.3',
      healthPct: 100,
      health: 'healthy',
    });
    expect(statCards({ total: 3, active: 2, visitors: 0 })).toMatchObject({
      healthPct: 67,
      health: 'attention',
      paused: 1,
    });
  });

  it('search matches name or slug, lower-cased, without a request', () => {
    expect(matchesSearch({ name: 'Pricing page', slug: 'pricing-page' }, 'pric')).toBe(true);
    expect(matchesSearch({ name: 'Support', slug: 'support' }, 'pric')).toBe(false);
    expect(matchesSearch({ name: 'Support', slug: 'help-desk' }, ' HELP ')).toBe(true);
    expect(matchesSearch({ name: 'x', slug: 'y' }, '')).toBe(true);
  });

  it('relative time is short', () => {
    const now = Date.parse('2026-10-02T10:00:00Z');
    const ago = (s: number) => new Date(now - s * 1000).toISOString();
    expect([
      relativeShort(ago(2), now),
      relativeShort(ago(300), now),
      relativeShort(ago(7200), now),
      relativeShort(ago(172800), now),
      relativeShort(ago(1_209_600), now),
    ]).toEqual(['2s ago', '5m ago', '2h ago', '2d ago', '2w ago']);
  });

  it('the row icon tint cycles over four colours', () => {
    expect(new Set(['0', '1', '2', '3', '4', '5'].map((c) => accentFor(`${c}-x`))).size).toBe(4);
  });
});

describe('WhatsApp number (WD-WGT-003)', () => {
  it('cc and national digits: +91 and 9876543210 belong to India; digits are stripped of everything else', () => {
    expect(dialCodeOf('IN')).toBe('+91');
    expect(countryOf('+91', '9876543210', 'US')).toBe('IN');
    expect(countryOf('', '', 'US')).toBe('US');
    expect(nationalDigits('(987) 654-3210')).toBe('9876543210');
  });

  it('a pasted international number is re-split so the dial code is not counted twice', () => {
    expect(splitInternational('+91 98765 43210')).toEqual({
      country: 'IN',
      national: '9876543210',
    });
    expect(splitInternational('9876543210')).toBeNull();
  });
});

describe('message catalogue', () => {
  const en = JSON.parse(
    readFileSync(join(process.cwd(), 'messages/en/chatbot-widget.json'), 'utf8'),
  ) as Record<string, unknown>;
  const get = (path: string) =>
    path
      .split('.')
      .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], en.chatbotWidget);

  it('every step problem and the engine labels have English text', () => {
    for (const k of [
      'name',
      'assistant',
      'whatsapp',
      'launcherColour',
      'headerTitle',
      'welcome',
      'bgImage',
    ]) {
      expect(typeof get(`builder.problem.${k}`)).toBe('string');
    }
    expect(get('builder.problem.name')).toBe('Name your widget.');
    expect(get('builder.preview.engine.both')).toBe('AI + WhatsApp');
  });
});
