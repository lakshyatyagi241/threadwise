import { describe, expect, it } from 'vitest';
import {
  REMINDER_BODY_MAX,
  REMINDER_MAX_MINUTES,
  STANDARD_TEXT,
  minutesOf,
  moveChannel,
  newReminder,
  previewOf,
  remindersChanged,
  remindersFromType,
  remindersToInput,
  renderPreview,
  splitMinutes,
  toggleChannel,
  validateReminders,
  type PreviewSample,
  type ReminderDraft,
} from './reminder-rules';

const row = (patch: Partial<ReminderDraft> = {}): ReminderDraft => ({
  ...newReminder('60'),
  ...patch,
});

describe('amounts and units', () => {
  it('turns an amount and a unit into minutes, and refuses what is not a whole number', () => {
    expect(minutesOf({ offset: '90', unit: 'minutes' })).toBe(90);
    expect(minutesOf({ offset: '2', unit: 'hours' })).toBe(120);
    expect(minutesOf({ offset: '1', unit: 'days' })).toBe(1440);
    expect(minutesOf({ offset: ' 3 ', unit: 'hours' })).toBe(180);
    for (const bad of ['', 'soon', '1.5', '-1', '1e3']) {
      expect(minutesOf({ offset: bad, unit: 'minutes' })).toBeNull();
    }
  });

  it('shows minutes in the largest unit that holds them exactly', () => {
    expect(splitMinutes(1440)).toEqual({ offset: '1', unit: 'days' });
    expect(splitMinutes(2880)).toEqual({ offset: '2', unit: 'days' });
    expect(splitMinutes(180)).toEqual({ offset: '3', unit: 'hours' });
    expect(splitMinutes(90)).toEqual({ offset: '90', unit: 'minutes' });
    expect(splitMinutes(1500)).toEqual({ offset: '25', unit: 'hours' });
    expect(splitMinutes(15)).toEqual({ offset: '15', unit: 'minutes' });
  });
});

describe('validateReminders', () => {
  it('accepts a normal list and ignores a row nobody filled in', () => {
    expect(validateReminders([row(), row({ kind: 'after' }), newReminder('')])).toEqual({});
  });

  it('wants a whole number of minutes up to 30 days', () => {
    const a = row({ offset: '0' });
    const b = row({ offset: 'x' });
    const c = row({ offset: String(REMINDER_MAX_MINUTES + 1) });
    const d = row({ offset: '30', unit: 'days' });
    const p = validateReminders([a, b, c, d]);
    expect(p[`reminder:${a.id}`]).toBe('offsetInvalid');
    expect(p[`reminder:${b.id}`]).toBe('offsetInvalid');
    expect(p[`reminder:${c.id}`]).toBe('offsetInvalid');
    expect(p[`reminder:${d.id}`]).toBeUndefined();
  });

  it('counts the same moment once per side of the booking: 1 hour in two units is a duplicate, before and after is not', () => {
    const a = row({ offset: '60' });
    const b = row({ offset: '1', unit: 'hours' });
    const c = row({ offset: '60', kind: 'after' });
    const p = validateReminders([a, b, c]);
    expect(p[`reminder:${b.id}`]).toBe('duplicate');
    expect(p[`reminder:${c.id}`]).toBeUndefined();
  });

  it('wants a channel and bounded texts, and at most eight', () => {
    const noChannel = row({ channels: [] });
    const longBody = row({ offset: '5', body: 'x'.repeat(REMINDER_BODY_MAX + 1) });
    const p = validateReminders([noChannel, longBody]);
    expect(p[`reminder:${noChannel.id}`]).toBe('channelsNone');
    expect(p[`reminder:${longBody.id}`]).toBe('bodyTooLong');
    const nine = Array.from({ length: 9 }, (_, i) => row({ offset: String(i + 1) }));
    expect(validateReminders(nine).reminders).toBe('tooMany');
    expect(validateReminders(nine.slice(0, 8)).reminders).toBeUndefined();
  });
});

describe('channels', () => {
  it('moves a channel in the preference and leaves it alone at the ends', () => {
    expect(moveChannel(['whatsapp', 'sms', 'email'], 2, -1)).toEqual(['whatsapp', 'email', 'sms']);
    expect(moveChannel(['whatsapp', 'sms'], 0, -1)).toEqual(['whatsapp', 'sms']);
    expect(moveChannel(['whatsapp', 'sms'], 1, 1)).toEqual(['whatsapp', 'sms']);
  });

  it('adds a channel last and never removes the last one', () => {
    expect(toggleChannel(['sms'], 'email')).toEqual(['sms', 'email']);
    expect(toggleChannel(['sms', 'email'], 'sms')).toEqual(['email']);
    expect(toggleChannel(['sms'], 'sms')).toEqual(['sms']);
  });
});

describe('to and from the API', () => {
  const saved = remindersFromType([
    {
      id: 'a',
      offsetMinutes: 60,
      label: '1h',
      isActive: true,
      kind: 'before',
      channels: ['sms', 'whatsapp'],
      subject: null,
      body: null,
      waTemplateId: 'tpl-1',
    },
    {
      id: 'b',
      offsetMinutes: 1440,
      label: null,
      isActive: false,
      kind: 'before',
      channels: ['email'],
      subject: 'Soon',
      body: 'Hi {{name}}',
      waTemplateId: null,
    },
    {
      id: 'c',
      offsetMinutes: 120,
      label: null,
      isActive: true,
      kind: 'after',
      channels: ['whatsapp'],
      subject: null,
      body: null,
      waTemplateId: null,
    },
  ]);

  it('round-trips a saved list: ids, switches, channels in order, texts and template', () => {
    expect(saved[1]).toMatchObject({ offset: '1', unit: 'days', enabled: false, serverId: 'b' });
    const input = remindersToInput(saved);
    // before-rules furthest first, then follow-ups
    expect(input.map((r) => [r.id, r.kind, r.offsetMinutes, r.isActive])).toEqual([
      ['b', 'before', 1440, false],
      ['a', 'before', 60, true],
      ['c', 'after', 120, true],
    ]);
    expect(input[1]).toMatchObject({
      channels: ['sms', 'whatsapp'],
      waTemplateId: 'tpl-1',
      label: '1h',
    });
    expect(input[0]).toMatchObject({ subject: 'Soon', body: 'Hi {{name}}' });
  });

  it('sends a rule added in this session without an id, and OFF', () => {
    const [r] = remindersToInput([newReminder('30')]);
    expect(r).toEqual({
      offsetMinutes: 30,
      label: null,
      isActive: false,
      kind: 'before',
      channels: ['whatsapp', 'sms', 'email'],
      subject: null,
      body: null,
      waTemplateId: null,
    });
    expect(r).not.toHaveProperty('id');
  });

  it('drops an empty row and a repeated moment, and keeps at most eight', () => {
    expect(
      remindersToInput([newReminder(''), row(), row({ offset: '1', unit: 'hours' })]),
    ).toHaveLength(1);
    const many = Array.from({ length: 10 }, (_, i) => row({ offset: String(i + 1) }));
    expect(remindersToInput(many)).toHaveLength(8);
  });

  it('tells a real change from re-typing the same thing', () => {
    expect(
      remindersChanged(
        saved,
        saved.map((r) => ({ ...r })),
      ),
    ).toBe(false);
    expect(remindersChanged(saved, [...saved, newReminder('')])).toBe(false);
    expect(
      remindersChanged(
        saved,
        saved.map((r, i) => (i === 0 ? { ...r, enabled: !r.enabled } : r)),
      ),
    ).toBe(true);
    expect(remindersChanged(saved, saved.slice(1))).toBe(true);
  });
});

describe('preview', () => {
  const sample: PreviewSample = {
    name: 'Alex',
    type: 'Consultation',
    slot: 'Tuesday · 10:00',
    date: 'Tuesday',
    time: '10:00',
    location: '12 Main Street',
    join_link: 'https://meet.example.com/x',
    manage_link: 'https://example.com/m',
  };

  it('fills the placeholders the way the server does and leaves an unknown one visible', () => {
    expect(renderPreview('Hi {{name}}, {{ type }} at {{time}}. {{typo}}', sample)).toBe(
      'Hi Alex, Consultation at 10:00. {{typo}}',
    );
  });

  it('shows the standard text of each kind when the rule has none', () => {
    expect(previewOf({ kind: 'before', body: '  ' }, sample)).toBe(
      renderPreview(STANDARD_TEXT.before, sample),
    );
    expect(previewOf({ kind: 'after', body: '' }, sample)).toContain('Consultation');
    expect(previewOf({ kind: 'after', body: 'Own text' }, sample)).toBe('Own text');
  });
});
