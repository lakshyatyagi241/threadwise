import { describe, expect, it } from 'vitest';
import { createTemplateInputSchema } from '@crm/contracts';
import { stateOf } from '../../../src/modules/appointments-booking/appointment-channels.service';
import type { SenderDirectory } from '../../../src/modules/appointments-booking/appointment-channels.repository';
import { toApiTemplate } from '../../../src/modules/appointments-booking/appointment-template.mapper';
import {
  PREDEFINED_TEMPLATES,
  findPredefined,
  libraryStatusOfWa,
  toWhatsappBody,
  unknownPlaceholders,
  variablesOf,
  waNameOf,
} from '../../../src/modules/appointments-booking/appointment-template.rules';
import {
  lintPrepared,
  prepareTemplate,
} from '../../../src/modules/message-templates/template-input';
import { waTemplateValues } from '../../../src/modules/appointments-booking/appointment-reminder.rules';

/** Pure rules of the appointment message library and the channel states (BL-350..BL-352). */

describe('the built-in set', () => {
  it('has a message for every kind on email and on WhatsApp', () => {
    for (const kind of ['confirmation', 'reminder', 'reschedule', 'cancellation', 'follow_up'] as const) {
      for (const channel of ['email', 'whatsapp'] as const) {
        expect(findPredefined(kind, channel, 'en'), `${kind}/${channel}`).toBeDefined();
      }
    }
    expect(PREDEFINED_TEMPLATES).toHaveLength(10);
  });

  it('uses only placeholders the booking messages know, and no hardcoded niche word', () => {
    for (const p of PREDEFINED_TEMPLATES) {
      expect(unknownPlaceholders(`${p.subject ?? ''} ${p.body}`), p.name).toEqual([]);
      expect(`${p.subject ?? ''} ${p.body}`).not.toMatch(/\bpatient|client|customer|lead\b/i);
    }
  });

  it.each(PREDEFINED_TEMPLATES.filter((p) => p.channel === 'whatsapp'))(
    'the WhatsApp message $key passes the platform lint as the template it becomes',
    (p) => {
      const wa = toWhatsappBody(p.body);
      expect(wa.ok).toBe(true);
      if (!wa.ok) return;
      const input = createTemplateInputSchema.parse({
        name: waNameOf(p.kind, p.language),
        language: p.language,
        metaCategory: p.metaCategory,
        templateType: 'standard',
        body: wa.body,
        variableMap: wa.variableMap,
        parameterFormat: 'POSITIONAL',
        connectionId: '11111111-1111-4111-8111-111111111111',
        submit: true,
      });
      const prepared = prepareTemplate(input);
      const errors = lintPrepared(prepared, false, input.name).filter((i) => i.severity === 'error');
      expect(errors).toEqual([]);
      // What the sender fills must be as many values as the template has placeholders.
      const values = waTemplateValues(wa.variables.length, {
        name: 'Asha',
        type: 'Consultation',
        date: 'Monday',
        time: '10:30',
      });
      expect(values).toHaveLength(wa.variables.length);
    },
  );

  it('submits the after-visit follow-up as marketing and the rest as utility', () => {
    expect(findPredefined('follow_up', 'whatsapp', 'en')?.metaCategory).toBe('MARKETING');
    for (const k of ['confirmation', 'reminder', 'reschedule', 'cancellation'] as const) {
      expect(findPredefined(k, 'whatsapp', 'en')?.metaCategory).toBe('UTILITY');
    }
  });
});

describe('variablesOf and unknownPlaceholders', () => {
  it('lists placeholders once, lower case, in first-use order, across several texts', () => {
    expect(variablesOf('Hi {{ Name }}', 'on {{date}} {{name}} {{time}}')).toEqual(['name', 'date', 'time']);
    expect(variablesOf(null, undefined)).toEqual([]);
  });
  it('finds a placeholder no booking message fills', () => {
    expect(unknownPlaceholders('Hi {{name}} {{patient_id}}')).toEqual(['patient_id']);
  });
});

describe('toWhatsappBody', () => {
  it('numbers the placeholders by the order the sender fills them', () => {
    const r = toWhatsappBody('Hi {{name}}, {{type}} on {{date}} at {{time}}.');
    expect(r).toMatchObject({
      ok: true,
      body: 'Hi {{1}}, {{2}} on {{3}} at {{4}}.',
      variables: ['name', 'type', 'date', 'time'],
    });
    if (r.ok) expect(r.variableMap.body.map((s) => s.key)).toEqual(['name', 'type', 'date', 'time']);
  });
  it('accepts a text with no placeholder', () => {
    expect(toWhatsappBody('We are open.')).toMatchObject({ ok: true, body: 'We are open.', variables: [] });
  });
  it('refuses a placeholder WhatsApp cannot fill', () => {
    const r = toWhatsappBody('Hi {{name}}, see {{slot}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain('{{slot}}');
  });
  it('refuses a skipped or reordered placeholder (the sender fills them in a fixed order)', () => {
    expect(toWhatsappBody('Hi {{name}} at {{time}}').ok).toBe(false);
    expect(toWhatsappBody('{{type}} for {{name}}').ok).toBe(false);
    expect(toWhatsappBody('{{date}}').ok).toBe(false);
  });
});

describe('libraryStatusOfWa', () => {
  const row = (over: Partial<Parameters<typeof libraryStatusOfWa>[0] & object> = {}) => ({
    status: 'approved',
    metaStatus: 'APPROVED',
    pausedUntil: null,
    rejectionReason: null,
    ...over,
  });
  const now = new Date('2027-01-20T10:00:00Z');

  it('a message with no template yet is a draft', () => {
    expect(libraryStatusOfWa(null, now)).toEqual({ status: 'draft', reason: null });
  });
  it('maps the template states', () => {
    expect(libraryStatusOfWa(row({ status: 'draft', metaStatus: null }), now).status).toBe('draft');
    expect(libraryStatusOfWa(row({ status: 'pending', metaStatus: 'PENDING' }), now).status).toBe('pending');
    expect(libraryStatusOfWa(row(), now)).toEqual({ status: 'approved', reason: null });
    expect(libraryStatusOfWa(row({ status: 'public' }), now).status).toBe('approved');
  });
  it('shows Meta\'s reason for a rejection', () => {
    expect(
      libraryStatusOfWa(row({ status: 'rejected', metaStatus: 'REJECTED', rejectionReason: 'Invalid format' }), now),
    ).toEqual({ status: 'rejected', reason: 'Invalid format' });
  });
  it('never calls a paused, disabled or out-of-sync template approved', () => {
    expect(
      libraryStatusOfWa(row({ pausedUntil: new Date('2027-01-21T00:00:00Z') }), now).status,
    ).toBe('rejected');
    expect(libraryStatusOfWa(row({ status: 'paused' }), now).status).toBe('rejected');
    expect(libraryStatusOfWa(row({ status: 'disabled' }), now).reason).toMatch(/disabled/);
    expect(libraryStatusOfWa(row({ metaStatus: 'PAUSED' }), now).status).toBe('rejected');
    // a pause that has ended no longer blocks
    expect(libraryStatusOfWa(row({ pausedUntil: new Date('2027-01-19T00:00:00Z') }), now).status).toBe('approved');
  });
});

describe('toApiTemplate', () => {
  const base = {
    id: 1,
    uuid: '22222222-2222-4222-8222-222222222222',
    kind: 'confirmation' as const,
    language: 'en',
    name: 'Booking confirmation',
    subject: null,
    body: 'Hi {{name}}',
    variables: ['name'],
    predefinedKey: 'confirmation',
    isActive: true,
    rowVersion: 1,
    createdAt: new Date('2027-01-20T00:00:00Z'),
    updatedAt: new Date('2027-01-20T00:00:00Z'),
    waTemplateId: null,
    waUuid: null,
    waStatus: null,
    waMetaStatus: null,
    waPausedUntil: null,
    waRejectionReason: null,
    connectionUuid: null,
    usedByTypes: 0,
  };

  it('an email message is usable at once; switched off it is not', () => {
    expect(toApiTemplate({ ...base, channel: 'email' }).usable).toBe(true);
    expect(toApiTemplate({ ...base, channel: 'email', isActive: false }).usable).toBe(false);
  });
  it('a WhatsApp message is usable only when its template is approved', () => {
    const wa = { ...base, channel: 'whatsapp' as const, waTemplateId: 5, waUuid: '33333333-3333-4333-8333-333333333333' };
    expect(toApiTemplate({ ...wa, waStatus: 'draft' }).usable).toBe(false);
    expect(toApiTemplate({ ...wa, waStatus: 'pending', waMetaStatus: 'PENDING' }).status).toBe('pending');
    expect(toApiTemplate({ ...wa, waStatus: 'approved', waMetaStatus: 'APPROVED' }).usable).toBe(true);
    const rejected = toApiTemplate({ ...wa, waStatus: 'rejected', waMetaStatus: 'REJECTED', waRejectionReason: 'No' });
    expect(rejected).toMatchObject({ status: 'rejected', rejectionReason: 'No', usable: false });
  });
});

describe('stateOf (the owner screen and the editor read this)', () => {
  const dir = (over: Partial<SenderDirectory> = {}): SenderDirectory => ({
    whatsapp: [],
    sms: [],
    email: [],
    whatsappDevice: false,
    ...over,
  });
  const sender = { id: 3, uuid: '44444444-4444-4444-8444-444444444444', label: '+91 98765' };
  const row = (channel: 'email' | 'whatsapp' | 'sms' | 'voice', enabled: boolean, over = {}) => ({
    id: 1,
    channel,
    enabled,
    defaultSenderId: null,
    source: 'owner' as const,
    rowVersion: 2,
    ...over,
  });

  it('a new workspace has not decided: nothing is enabled', () => {
    const s = stateOf('email', undefined, dir({ email: [sender] }));
    expect(s).toMatchObject({ enabled: false, decided: false, source: null, connection: 'connected', usable: false });
  });
  it('enabled but not connected is not usable (the editor says Connect it in Settings)', () => {
    expect(stateOf('sms', row('sms', true), dir())).toMatchObject({
      enabled: true,
      connection: 'not_connected',
      usable: false,
    });
  });
  it('enabled and connected is usable', () => {
    expect(stateOf('sms', row('sms', true), dir({ sms: [sender] }))).toMatchObject({
      usable: true,
      senders: [{ id: sender.uuid, label: sender.label }],
    });
  });
  it('a connected WhatsApp device alone counts as connected (text only)', () => {
    expect(stateOf('whatsapp', row('whatsapp', true), dir({ whatsappDevice: true })).usable).toBe(true);
  });
  it('a kept default sender is shown; one that is gone is not', () => {
    const kept = stateOf('email', row('email', true, { defaultSenderId: 3 }), dir({ email: [sender] }));
    expect(kept.defaultSenderId).toBe(sender.uuid);
    const gone = stateOf('email', row('email', true, { defaultSenderId: 99 }), dir({ email: [sender] }));
    expect(gone.defaultSenderId).toBeNull();
  });
  it('voice is listed, coming soon, and never enabled or usable even if a row said so', () => {
    expect(stateOf('voice', undefined, dir())).toMatchObject({ connection: 'coming_soon', enabled: false, usable: false });
    expect(stateOf('voice', row('voice', true), dir())).toMatchObject({ enabled: false, usable: false });
  });
  it('the legacy default is reported as such', () => {
    expect(stateOf('email', row('email', true, { source: 'legacy_default' }), dir()).source).toBe('legacy_default');
  });
});
