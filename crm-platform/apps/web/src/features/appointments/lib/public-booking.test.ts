import { describe, expect, it } from 'vitest';
import type { BookingQuestion, PublicBooking } from '../api/schemas';
import {
  askedQuestions,
  buildBookInput,
  calendarEvent,
  coveredField,
  isEmail,
  isNumberText,
  isPhone,
  manageActions,
  manageStateOf,
  placeServerErrors,
  priceLabel,
  priceLines,
  safeHttpUrl,
  validateAnswer,
  validateAnswers,
  validateDetails,
  whenLines,
  whereOf,
} from './public-booking';

const q = (over: Partial<BookingQuestion> = {}): BookingQuestion => ({
  label: 'Question',
  type: 'text',
  options: [],
  required: false,
  mapToContactField: null,
  ...over,
});

describe('field checks', () => {
  it('reads emails', () => {
    expect(isEmail('ana@acme.test')).toBe(true);
    expect(isEmail(' ana@acme.test ')).toBe(true);
    for (const bad of ['ana', 'ana@', '@acme.test', 'ana@acme', 'a na@acme.test', 'ana@acme.t'])
      expect(isEmail(bad)).toBe(false);
    expect(isEmail(`${'a'.repeat(200)}@acme.test`)).toBe(false);
  });

  it('reads phone numbers', () => {
    for (const ok of ['+34 600 111 222', '(555) 123-4567', '600111222', '+971501234567'])
      expect(isPhone(ok)).toBe(true);
    for (const bad of ['12345', 'call me', '+1234567890123456', '600-abc-1234', ''])
      expect(isPhone(bad)).toBe(false);
  });

  it('reads numbers', () => {
    for (const ok of ['3', '-3', '3.25', ' 12 ']) expect(isNumberText(ok)).toBe(true);
    for (const bad of ['', 'abc', '1,5', '1e5', '1.', '.5', '--1'])
      expect(isNumberText(bad)).toBe(false);
  });
});

describe('validateDetails', () => {
  it('needs a name and a valid email; the phone is optional', () => {
    expect(validateDetails({ name: '', email: '', phone: '' })).toEqual({
      name: 'required',
      email: 'required',
    });
    expect(validateDetails({ name: 'Ana', email: 'nope', phone: '' })).toEqual({
      email: 'invalid',
    });
    expect(validateDetails({ name: 'Ana', email: 'ana@acme.test', phone: '' })).toEqual({});
    expect(validateDetails({ name: 'Ana', email: 'ana@acme.test', phone: 'abc' })).toEqual({
      phone: 'invalid',
    });
    expect(validateDetails({ name: '  ', email: 'ana@acme.test', phone: '' })).toEqual({
      name: 'required',
    });
    expect(validateDetails({ name: 'x'.repeat(192), email: 'ana@acme.test', phone: '' })).toEqual({
      name: 'tooLong',
    });
  });

  it('needs the phone when a required question maps to it', () => {
    const questions = [q({ type: 'phone', required: true, mapToContactField: 'mobile' })];
    expect(validateDetails({ name: 'Ana', email: 'ana@acme.test', phone: '' }, questions)).toEqual({
      phone: 'required',
    });
    expect(
      validateDetails({ name: 'Ana', email: 'ana@acme.test', phone: '+34 600 111 222' }, questions),
    ).toEqual({});
  });
});

describe('validateAnswer', () => {
  it('honours required for every type', () => {
    for (const type of [
      'text',
      'textarea',
      'select',
      'number',
      'email',
      'phone',
      'date',
    ] as const) {
      const question = q({ type, options: ['a'], required: true });
      expect(validateAnswer(question, '  ')).toBe('required');
      expect(validateAnswer({ ...question, required: false }, '')).toBeNull();
    }
  });

  it('checks each type', () => {
    expect(validateAnswer(q({ type: 'text' }), 'x'.repeat(501))).toBe('tooLong');
    expect(validateAnswer(q({ type: 'textarea' }), 'x'.repeat(501))).toBeNull();
    expect(validateAnswer(q({ type: 'textarea' }), 'x'.repeat(2001))).toBe('tooLong');
    expect(validateAnswer(q({ type: 'select', options: ['1-10', '11-50'] }), '11-50')).toBeNull();
    expect(validateAnswer(q({ type: 'select', options: ['1-10', '11-50'] }), '500')).toBe(
      'invalid',
    );
    expect(validateAnswer(q({ type: 'number' }), '12.5')).toBeNull();
    expect(validateAnswer(q({ type: 'number' }), 'twelve')).toBe('invalid');
    expect(validateAnswer(q({ type: 'email' }), 'x@y.co')).toBeNull();
    expect(validateAnswer(q({ type: 'email' }), 'x@y')).toBe('invalid');
    expect(validateAnswer(q({ type: 'phone' }), '+34 600 111 222')).toBeNull();
    expect(validateAnswer(q({ type: 'phone' }), '1')).toBe('invalid');
    expect(validateAnswer(q({ type: 'date' }), '2026-10-05')).toBeNull();
    expect(validateAnswer(q({ type: 'date' }), '2026-02-30')).toBe('invalid');
    expect(validateAnswer(q({ type: 'date' }), '05/10/2026')).toBe('invalid');
  });
});

describe('questions covered by the details', () => {
  const questions = [
    q({ label: 'Company', required: true }),
    q({ label: 'Email address', type: 'email', required: true, mapToContactField: 'email' }),
    q({ label: 'Mobile', type: 'phone', mapToContactField: 'mobile' }),
    q({ label: 'Full name', mapToContactField: 'name' }),
    q({ label: 'Notes', type: 'textarea' }),
  ];

  it('knows which field a question maps to', () => {
    expect(questions.map(coveredField)).toEqual([null, 'email', 'phone', 'name', null]);
  });

  it('asks only the questions the details do not cover, keeping their own index', () => {
    expect(askedQuestions(questions).map((a) => a.index)).toEqual([0, 4]);
  });

  it('validates only the asked ones', () => {
    expect(validateAnswers(questions, {})).toEqual({ 0: 'required' });
    expect(validateAnswers(questions, { 0: 'Acme' })).toEqual({});
  });
});

describe('buildBookInput', () => {
  const questions = [
    q({ label: 'Company', required: true }),
    q({ label: 'Email address', type: 'email', mapToContactField: 'email' }),
    q({ label: 'Notes', type: 'textarea' }),
    q({ label: 'Team size', type: 'select', options: ['1-10', '11-50'] }),
  ];

  it('builds the body: trimmed, empty answers left out, covered answers from the details', () => {
    const built = buildBookInput({
      startsAt: '2026-10-06T04:00:00.000Z',
      zone: 'Asia/Tokyo',
      details: { name: ' Ana Lopez ', email: ' ana@acme.test ', phone: '' },
      questions,
      values: { 0: ' Acme ', 2: '   ', 3: '11-50' },
    });
    expect(built.input).toEqual({
      startsAt: '2026-10-06T04:00:00.000Z',
      name: 'Ana Lopez',
      email: 'ana@acme.test',
      inviteeTimezone: 'Asia/Tokyo',
      answers: [
        { label: 'Company', answer: 'Acme' },
        { label: 'Email address', answer: 'ana@acme.test' },
        { label: 'Team size', answer: '11-50' },
      ],
    });
    expect(built.sources).toEqual([0, 1, 3]);
    expect('phone' in built.input).toBe(false);
  });

  it('sends the phone when there is one', () => {
    const built = buildBookInput({
      startsAt: '2026-10-06T04:00:00.000Z',
      zone: 'UTC',
      details: { name: 'Ana', email: 'ana@acme.test', phone: ' +34 600 111 222 ' },
      questions: [],
      values: {},
    });
    expect(built.input.phone).toBe('+34 600 111 222');
    expect(built.input.answers).toEqual([]);
  });

  it('carries the consent line only when the visitor ticked it, with the version they saw', () => {
    const base = {
      startsAt: '2026-10-06T04:00:00.000Z',
      zone: 'UTC',
      details: { name: 'Ana', email: 'ana@acme.test', phone: '' },
      questions: [],
      values: {},
    };
    expect('consent' in buildBookInput(base).input).toBe(false);
    expect(buildBookInput({ ...base, consentVersion: 3 }).input.consent).toEqual({
      given: true,
      version: 3,
    });
  });
});

describe('placeServerErrors', () => {
  const questions = [
    q({ label: 'Company' }),
    q({ label: 'Email address', type: 'email', mapToContactField: 'email' }),
    q({ label: 'Notes' }),
  ];
  const sources = [0, 1, 2];

  it('places detail, time and answer errors', () => {
    const out = placeServerErrors(
      { name: 'x', email: 'x', startsAt: 'x', 'answers.0': 'x', 'answers[2].answer': 'x' },
      { sources },
      questions,
    );
    expect(out).toEqual({
      details: { name: true, email: true },
      answers: { 0: true, 2: true },
      startsAt: true,
      other: false,
    });
  });

  it('places an error on a covered question on the detail it maps to', () => {
    const out = placeServerErrors({ 'answers.1': 'x' }, { sources }, questions);
    expect(out.details).toEqual({ email: true });
    expect(out.answers).toEqual({});
  });

  it('follows the sources when empty answers were left out', () => {
    const out = placeServerErrors({ 'answers.0': 'x' }, { sources: [2] }, questions);
    expect(out.answers).toEqual({ 2: true });
  });

  it('flags a path that is not on the page', () => {
    expect(
      placeServerErrors({ nonsense: 'x', 'answers.9': 'x' }, { sources }, questions).other,
    ).toBe(true);
  });
});

describe('whenLines', () => {
  // 2026-10-06 04:00 UTC: 13:00 in Tokyo, 21:00 on the 5th in Los Angeles, 09:30 in Kolkata.
  const start = '2026-10-06T04:00:00.000Z';
  const end = '2026-10-06T04:30:00.000Z';

  it('shows the visitor zone, and the service zone when it reads another clock', () => {
    const w = whenLines(start, end, 'America/Los_Angeles', 'Asia/Tokyo', 'en-US');
    expect(w.visitor.day).toBe('Monday, October 5, 2026');
    expect(w.visitor.time).toMatch(/9:00\s?PM/);
    expect(w.visitor.zone).toBe('America/Los Angeles');
    expect(w.service?.day).toBe('Tuesday, October 6, 2026');
    expect(w.service?.time).toMatch(/1:00\s?PM/);
  });

  it('shows one line when both zones read the same', () => {
    expect(whenLines(start, end, 'Asia/Kolkata', 'Asia/Calcutta', 'en-US').service).toBeNull();
    expect(whenLines(start, end, 'UTC', 'UTC', 'en-US').service).toBeNull();
    expect(
      whenLines(start, end, 'Europe/London', 'Africa/Abidjan', 'en-US').service,
    ).not.toBeNull();
  });
});

describe('where', () => {
  it('prefers the video link, then the type of place', () => {
    expect(
      whereOf({
        meetUrl: 'https://meet.example.test/abc',
        location: '12 MG Road',
        locationType: 'address',
      }),
    ).toEqual({
      kind: 'video',
      url: 'https://meet.example.test/abc',
    });
    expect(whereOf({ meetUrl: null, location: '12 MG Road', locationType: 'address' })).toEqual({
      kind: 'address',
      text: '12 MG Road',
    });
    expect(whereOf({ meetUrl: null, location: '+34 600 111 222', locationType: 'phone' })).toEqual({
      kind: 'phone',
      text: '+34 600 111 222',
      tel: 'tel:+34600111222',
    });
    expect(
      whereOf({
        meetUrl: null,
        location: 'https://zoom.example.test/j/1',
        locationType: 'virtual',
      }),
    ).toEqual({
      kind: 'video',
      url: 'https://zoom.example.test/j/1',
    });
    expect(whereOf({ meetUrl: null, location: null, locationType: 'virtual' })).toEqual({
      kind: 'videoLater',
    });
    expect(whereOf({ meetUrl: null, location: null, locationType: 'address' })).toBeNull();
    expect(whereOf({ meetUrl: null, location: '', locationType: null })).toBeNull();
  });

  it('never links an address that is not http or https', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,x')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl('https://meet.example.test/a')).toBe('https://meet.example.test/a');
    expect(
      whereOf({ meetUrl: 'javascript:alert(1)', location: '12 MG Road', locationType: 'address' }),
    ).toEqual({
      kind: 'address',
      text: '12 MG Road',
    });
  });
});

const booking = (over: Partial<PublicBooking> = {}): PublicBooking => ({
  status: 'confirmed',
  typeName: 'Site visit',
  startsAt: '2026-10-06T04:00:00.000Z',
  endsAt: '2026-10-06T05:00:00.000Z',
  timezone: 'Asia/Kolkata',
  location: '12 MG Road, Bengaluru',
  locationType: 'address',
  meetUrl: null,
  description: 'We measure up.',
  manageToken: 'tok123456789012345678',
  manageUrl: 'https://app.example.test/b/manage/tok123456789012345678',
  canReschedule: true,
  canCancel: true,
  ...over,
});

describe('calendarEvent', () => {
  it('builds the event of a booking with the manage link', () => {
    const e = calendarEvent(booking(), 'Acme Clinic');
    expect(e.title).toBe('Site visit - Acme Clinic');
    expect(e.location).toBe('12 MG Road, Bengaluru');
    expect(e.description).toContain('We measure up.');
    expect(e.description).toContain('https://app.example.test/b/manage/tok123456789012345678');
    expect(e.status).toBe('CONFIRMED');
    expect(e.startsAt).toBe('2026-10-06T04:00:00.000Z');
  });

  it('is tentative while the booking waits for confirmation', () => {
    expect(calendarEvent(booking({ status: 'pending' }), 'Acme').status).toBe('TENTATIVE');
  });

  it('has no place for a video call whose link is not known yet', () => {
    expect(
      calendarEvent(booking({ location: null, locationType: 'virtual' }), '').location,
    ).toBeNull();
    expect(calendarEvent(booking(), '').title).toBe('Site visit');
  });
});

describe('manage state', () => {
  const before = new Date('2026-10-05T00:00:00Z');
  const after = new Date('2026-10-07T00:00:00Z');

  it('is open before the start, passed after it', () => {
    expect(manageStateOf(booking(), before)).toBe('open');
    expect(manageStateOf(booking({ status: 'pending' }), before)).toBe('open');
    expect(manageStateOf(booking(), after)).toBe('passed');
  });

  it('keeps the closed statuses', () => {
    for (const status of ['cancelled', 'completed', 'no_show'] as const) {
      expect(manageStateOf(booking({ status }), before)).toBe(status);
    }
  });

  it('offers reschedule and cancel only while open, in the future, and allowed by the server', () => {
    expect(manageActions(booking(), before)).toEqual({ reschedule: true, cancel: true });
    expect(manageActions(booking(), after)).toEqual({ reschedule: false, cancel: false });
    expect(manageActions(booking({ status: 'cancelled' }), before)).toEqual({
      reschedule: false,
      cancel: false,
    });
    expect(manageActions(booking({ canCancel: false }), before)).toEqual({
      reschedule: true,
      cancel: false,
    });
  });
});

describe('price', () => {
  it('has no lines for a free service or one without a currency', () => {
    expect(priceLines({ currency: null, feeMinor: 0, taxPct: 0, dueNowMinor: 0 })).toBeNull();
    expect(priceLines({ currency: 'USD', feeMinor: 0, taxPct: 18, dueNowMinor: 0 })).toBeNull();
    expect(priceLines({ currency: null, feeMinor: 1000, taxPct: 0, dueNowMinor: 0 })).toBeNull();
    expect(priceLabel({ currency: 'USD', feeMinor: 0 }, 'en-US')).toBeNull();
  });

  it('adds tax and caps what is due now at the total', () => {
    expect(
      priceLines({ currency: 'INR', feeMinor: 150000, taxPct: 18, dueNowMinor: 50000 }),
    ).toEqual({
      currency: 'INR',
      taxPct: 18,
      feeMinor: 150000,
      taxMinor: 27000,
      totalMinor: 177000,
      dueNowMinor: 50000,
    });
    expect(
      priceLines({ currency: 'USD', feeMinor: 1000, taxPct: 0, dueNowMinor: 99999 })?.dueNowMinor,
    ).toBe(1000);
  });

  it('formats the fee for a card', () => {
    expect(priceLabel({ currency: 'USD', feeMinor: 15000 }, 'en-US')).toBe('$150.00');
  });
});
