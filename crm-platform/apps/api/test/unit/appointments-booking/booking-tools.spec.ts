import { describe, expect, it } from 'vitest';
import {
  BOOKING_TOOL_ARGS,
  BOOKING_TOOL_MAX_DAYS,
  BOOKING_TOOL_MAX_SLOTS,
  BOOKING_TOOL_NAMES,
  BOOKING_TOOL_RESULTS,
  BOOKING_TOOLS,
  parseBookingToolCall,
} from '@crm/contracts';

/** The booking tools an agent or a chatbot may be given (BL-035): their definitions, arguments and results. */
const SERVICE = '5c1e0000-0000-4000-8000-000000000001';
const APPT = '5c1e0000-0000-4000-8000-000000000002';
const WHEN = '2026-10-05T03:30:00.000Z';

describe('the definitions a model is given', () => {
  it('there is one for every tool, with a description and an object schema that names its required fields', () => {
    expect(BOOKING_TOOLS.map((t) => t.name)).toEqual([...BOOKING_TOOL_NAMES]);
    for (const t of BOOKING_TOOLS) {
      expect(t.description.length, t.name).toBeGreaterThan(40);
      expect(t.parameters.type).toBe('object');
      expect(t.parameters.additionalProperties).toBe(false);
    }
  });

  it("only the two writes are writes, and each of them requires the customer's confirmation", () => {
    const writes = BOOKING_TOOLS.filter((t) => t.write).map((t) => t.name);
    expect(writes).toEqual(['book_appointment', 'reschedule_appointment']);
    for (const name of writes) {
      const t = BOOKING_TOOLS.find((x) => x.name === name)!;
      expect(t.parameters.required as string[]).toContain('confirmed');
    }
  });

  it('every property in a JSON schema is a property of the Zod arguments, and the other way round', () => {
    for (const t of BOOKING_TOOLS) {
      const json = Object.keys((t.parameters.properties ?? {}) as Record<string, unknown>).sort();
      const zod = Object.keys(
        (BOOKING_TOOL_ARGS[t.name] as unknown as { shape: Record<string, unknown> }).shape,
      ).sort();
      expect(json, t.name).toEqual(zod);
    }
  });

  it('tells the model how many times it gets, so a loop cannot walk the calendar', () => {
    expect(BOOKING_TOOLS.find((t) => t.name === 'check_availability')!.description).toContain(
      String(BOOKING_TOOL_MAX_SLOTS),
    );
  });
});

describe('parseBookingToolCall', () => {
  it('accepts a valid read and fills the defaults', () => {
    const r = parseBookingToolCall('check_availability', { serviceId: SERVICE });
    expect(r).toMatchObject({ ok: true, name: 'check_availability' });
    expect((r as { args: { days: number } }).args.days).toBe(7);
  });

  it('refuses a window longer than the limit, an id that is not a uuid, and unknown keys', () => {
    expect(
      parseBookingToolCall('check_availability', {
        serviceId: SERVICE,
        days: BOOKING_TOOL_MAX_DAYS + 1,
      }),
    ).toMatchObject({
      ok: false,
      code: 'invalid_arguments',
    });
    expect(parseBookingToolCall('check_availability', { serviceId: 'the haircut' })).toMatchObject({
      ok: false,
      code: 'invalid_arguments',
    });
    expect(
      parseBookingToolCall('check_availability', { serviceId: SERVICE, extra: 1 }),
    ).toMatchObject({ ok: false });
    expect(parseBookingToolCall('list_services', { anything: true })).toMatchObject({ ok: false });
  });

  it('a write the customer has not confirmed is not_confirmed, never run', () => {
    for (const [name, args] of [
      ['book_appointment', { serviceId: SERVICE, startsAt: WHEN, confirmed: false }],
      ['reschedule_appointment', { appointmentId: APPT, startsAt: WHEN, confirmed: false }],
    ] as const) {
      expect(parseBookingToolCall(name, args)).toMatchObject({ ok: false, code: 'not_confirmed' });
    }
  });

  it('a confirmed write is accepted with its typed arguments', () => {
    expect(
      parseBookingToolCall('book_appointment', {
        serviceId: SERVICE,
        startsAt: WHEN,
        confirmed: true,
      }),
    ).toMatchObject({
      ok: true,
      name: 'book_appointment',
    });
    expect(
      parseBookingToolCall('reschedule_appointment', {
        appointmentId: APPT,
        startsAt: WHEN,
        confirmed: true,
      }),
    ).toMatchObject({
      ok: true,
    });
  });

  it('a write cannot omit confirmed to slip past the check', () => {
    expect(
      parseBookingToolCall('book_appointment', { serviceId: SERVICE, startsAt: WHEN }),
    ).toMatchObject({ ok: false });
  });

  it('a start must be an instant with an offset (a wall time with no zone is ambiguous)', () => {
    expect(
      parseBookingToolCall('book_appointment', {
        serviceId: SERVICE,
        startsAt: '2026-10-05T09:00:00',
        confirmed: true,
      }),
    ).toMatchObject({
      ok: false,
      code: 'invalid_arguments',
    });
    expect(
      parseBookingToolCall('book_appointment', {
        serviceId: SERVICE,
        startsAt: '2026-10-05T09:00:00+05:30',
        confirmed: true,
      }),
    ).toMatchObject({
      ok: true,
    });
  });

  it('answers are keyed by question id', () => {
    expect(
      parseBookingToolCall('book_appointment', {
        serviceId: SERVICE,
        startsAt: WHEN,
        answers: { 'not a uuid': 'x' },
        confirmed: true,
      }),
    ).toMatchObject({ ok: false });
  });

  it('an unknown tool is named, not guessed at', () => {
    expect(parseBookingToolCall('delete_all_appointments', {})).toMatchObject({
      ok: false,
      code: 'unknown_tool',
    });
  });

  it('takes no phone, e-mail or contact id for a reschedule: the conversation already knows the customer', () => {
    expect(
      parseBookingToolCall('reschedule_appointment', {
        appointmentId: APPT,
        startsAt: WHEN,
        confirmed: true,
        phone: '+919800000001',
      }),
    ).toMatchObject({ ok: false });
  });
});

describe('the results', () => {
  it('a booking result carries the manage link and no contact detail', () => {
    const result = {
      ok: true as const,
      data: {
        appointmentId: APPT,
        status: 'confirmed' as const,
        startsAt: WHEN,
        endsAt: '2026-10-05T04:00:00.000Z',
        requiresApproval: false,
        paymentDue: null,
        manageUrl: 'https://app.example/b/manage/abc',
      },
    };
    expect(BOOKING_TOOL_RESULTS.book_appointment.parse(result).data.manageUrl).toContain(
      '/b/manage/',
    );
    // Anything beyond the contract is dropped, so a service that returned a phone number could not leak it through the tool.
    const leaked = BOOKING_TOOL_RESULTS.book_appointment.parse({
      ...result,
      data: { ...result.data, phone: '+919800000001' },
    });
    expect(JSON.stringify(leaked)).not.toContain('+9198');
  });

  it('an availability result is capped', () => {
    const many = Array.from({ length: BOOKING_TOOL_MAX_SLOTS + 1 }, (_, i) => ({
      startsAt: new Date(Date.UTC(2026, 9, 5, i)).toISOString(),
      endsAt: new Date(Date.UTC(2026, 9, 5, i, 30)).toISOString(),
    }));
    expect(() =>
      BOOKING_TOOL_RESULTS.check_availability.parse({
        ok: true,
        data: { timezone: 'UTC', slots: many, hasMore: true },
      }),
    ).toThrow();
  });
});
