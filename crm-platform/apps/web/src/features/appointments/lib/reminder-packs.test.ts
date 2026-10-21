import { describe, expect, it } from 'vitest';
import type { ReminderPackPreview } from '@crm/contracts';
import {
  applyBlock,
  defaultSample,
  fillSample,
  newTemplates,
  packStepWhen,
  previewCounts,
  waitingTemplates,
} from './reminder-packs';

const step = (stepKind: string, action: 'add' | 'replace' | 'unchanged', status = 'new') =>
  ({
    step: { stepKind },
    action,
    existing: null,
    email: { subject: '', body: '' },
    whatsapp: { templateName: `t_${stepKind}`, body: '', status, buttons: [] },
  }) as unknown as ReminderPackPreview['steps'][number];

const preview = (over: Partial<ReminderPackPreview> = {}): ReminderPackPreview =>
  ({
    steps: [step('confirmation', 'add'), step('reminder_24h', 'replace', 'pending')],
    kept: [],
    timedSteps: 2,
    timedStepsMax: 5,
    blocked: null,
    needsConfirm: false,
    ...over,
  }) as unknown as ReminderPackPreview;

describe('sample values', () => {
  it('fills the seven values and the email-only ones, leaving unknown names as written', () => {
    const v = defaultSample('en', 'Consultation');
    const out = fillSample(
      'Hi {{name}}, {{type}} on {{date}} at {{time}}, {{location}}. {{join_link}} {{manage_link}} {{host_name}} {{map_link}} {{unknown}}',
      v,
      { pack: 'sales_meeting', language: 'en' },
    );
    expect(out).toContain(
      'Hi Alex, Consultation on Tuesday, 15 January at 10:00 AM, 12 Main Street.',
    );
    expect(out).toContain(
      'https://meet.example.com/abc-defg https://example.com/manage/xyz Sam Rivera https://maps.example.com',
    );
    expect(out).toContain('{{unknown}}');
  });

  it('accepts spaces inside the braces', () => {
    expect(
      fillSample('Hi {{ name }}', defaultSample('en', 'x'), { pack: 'clinic', language: 'en' }),
    ).toBe('Hi Alex');
  });

  it('never names the service for the medical packs (the appointment is not told)', () => {
    const v = defaultSample('en', 'Cardiology review');
    expect(fillSample('Your {{type}}', v, { pack: 'clinic', language: 'en' })).toBe(
      'Your appointment',
    );
    expect(fillSample('Your {{type}}', v, { pack: 'dental', language: 'hi' })).toBe(
      'Your अपॉइंटमेंट',
    );
    expect(fillSample('Your {{type}}', v, { pack: 'salon_spa', language: 'en' })).toBe(
      'Your Cardiology review',
    );
  });

  it('uses sample content in the language of the message', () => {
    expect(defaultSample('hi', 'x').name).not.toBe(defaultSample('en', 'x').name);
  });
});

describe('when a step goes out', () => {
  it('is an event, or an amount of time before or after', () => {
    expect(packStepWhen({ kind: 'event', offsetMinutes: 0 })).toEqual({ side: 'event' });
    expect(packStepWhen({ kind: 'before', offsetMinutes: 1440 })).toEqual({
      side: 'before',
      count: 1,
      unit: 'days',
    });
    expect(packStepWhen({ kind: 'after', offsetMinutes: 90 * 1440 })).toEqual({
      side: 'after',
      count: 90,
      unit: 'days',
    });
    expect(packStepWhen({ kind: 'after', offsetMinutes: 120 })).toEqual({
      side: 'after',
      count: 2,
      unit: 'hours',
    });
  });
});

describe('applying', () => {
  const ok = { canEdit: true, dirty: false, confirmed: false };
  it('waits for the preview, then goes', () => {
    expect(applyBlock({ ...ok, preview: undefined })).toBe('loading');
    expect(applyBlock({ ...ok, preview: preview() })).toBeNull();
  });

  it('is held for a viewer, for unsaved edits, and over the cap', () => {
    expect(applyBlock({ ...ok, canEdit: false, preview: preview() })).toBe('readOnly');
    expect(applyBlock({ ...ok, dirty: true, preview: preview() })).toBe('unsaved');
    expect(applyBlock({ ...ok, preview: preview({ blocked: 'cap_exceeded' }) })).toBe('cap');
  });

  it('needs the replacement confirmed, and nothing else once it is', () => {
    const p = preview({ needsConfirm: true });
    expect(applyBlock({ ...ok, preview: p })).toBe('confirm');
    expect(applyBlock({ ...ok, preview: p, confirmed: true })).toBeNull();
    // a cap beats a confirmation: there is nothing to confirm
    expect(
      applyBlock({
        ...ok,
        preview: preview({ needsConfirm: true, blocked: 'cap_exceeded' }),
        confirmed: true,
      }),
    ).toBe('cap');
  });
});

describe('summaries', () => {
  it('counts what the pack adds, replaces and leaves, and the templates it creates', () => {
    const p = preview({
      steps: [step('a', 'add'), step('b', 'replace'), step('c', 'unchanged', 'approved')],
    });
    expect(previewCounts(p)).toEqual({ add: 1, replace: 1, unchanged: 1 });
    expect(newTemplates(p)).toBe(2);
  });

  it('counts the templates that still wait for Meta', () => {
    expect(waitingTemplates(['approved', 'pending', 'draft', 'rejected'])).toBe(2);
    expect(waitingTemplates([])).toBe(0);
  });
});
