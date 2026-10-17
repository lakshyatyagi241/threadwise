import { z } from 'zod';

/**
 * Bookings through agents and chatbots, as TOOLS (BL-035, the contract only).
 *
 * An AI agent or a chatbot that can be given tools (a model call that may answer "run `check_availability` with these arguments" and be handed the
 * result) books the way a person does: look at what is offered, pick a time, confirm, and change it later. This file is the vendor-neutral
 * definition of those tools and the exact shape of their arguments and results, so the day a tool-calling loop exists for the customer-facing AI
 * (the AI Agent Studio responder and the chat widget reply are single-shot completions today) binding them is one adapter, not a design.
 *
 * What a binding must do (the rules are part of the contract, not a suggestion):
 *
 *  1. **Run as the bot, inside the workspace, through the existing services.** `list_services` is `BookingOffersService.offer`, `check_availability`
 *     is `.days` / `.times` (or the slot engine over a date window), `book_appointment` is `.reserve` then `.book` (actor `bot`, source `chat`, the
 *     same engine, the same guards, the same plan cap and double-booking guarantee as a person booking), `reschedule_appointment` is the
 *     customer's own move (`PublicBookingService.reschedule` rules: an offered slot, not started, status pending or confirmed). Nothing here is a
 *     second booking path.
 *  2. **A write needs the customer's explicit yes in the conversation** (`confirm: true` below). The binding stops at the call, shows the customer
 *     the service, the time in THEIR time zone and any amount due, and runs it only after a clear confirmation turn. The model never confirms for
 *     them.
 *  3. **Identity.** The tool never takes a phone, e-mail or contact id from the model for a reschedule: the conversation is already bound to a
 *     contact, and the appointment must belong to that contact (else `not_found`, never `forbidden`: no oracle for other people's bookings). A
 *     booking made through the tool is attached to the conversation's contact; a name, phone or e-mail is accepted only for a visitor who has no
 *     contact yet and goes through the same find-or-create the booking page uses.
 *  4. **Consent and privacy.** Booking records no marketing consent and never grants any (`consent` stays on the booking page's checkbox). The
 *     confirmation and reminder messages the booking triggers are UTILITY messages. The result carries no phone, e-mail, notes, answers or
 *     manage link of anyone; `book_appointment` returns the manage link only as `manageUrl` to be shown to the SAME customer in the same thread.
 *  5. **Idempotent and bounded.** Every write carries an idempotency key (`<conversation id>:<tool call id>`): a retried call books once. A call is
 *     refused after `BOOKING_TOOL_MAX_WRITES_PER_CONVERSATION` writes in one conversation, and `check_availability` returns at most
 *     `BOOKING_TOOL_MAX_SLOTS` times, so a loop cannot enumerate the calendar.
 *  6. **Errors are results, not exceptions.** A refusal comes back as `{ ok: false, code, message }` with the stable codes below, so the model can
 *     tell the customer something true ("that time was just taken, here are others") instead of the turn failing.
 */

export const BOOKING_TOOL_NAMES = [
  'list_services',
  'check_availability',
  'book_appointment',
  'reschedule_appointment',
] as const;
export type BookingToolName = (typeof BOOKING_TOOL_NAMES)[number];

export const BOOKING_TOOL_MAX_SLOTS = 9;
export const BOOKING_TOOL_MAX_DAYS = 14;
export const BOOKING_TOOL_MAX_WRITES_PER_CONVERSATION = 3;

/** Stable reasons a tool call is refused. The model is given the code and a sentence; the customer is never shown the code. */
export const BOOKING_TOOL_ERRORS = [
  /** The workspace's plan does not include booking, or this month's cap is reached. */
  'unavailable',
  /** No such service, or it is paused. */
  'unknown_service',
  /** The time is not one the service offers (outside the hours, inside the notice, past the horizon). */
  'slot_unavailable',
  /** The seat was just taken by someone else. */
  'slot_taken',
  /** An answer the service asks for is missing or not a valid choice. */
  'answers_invalid',
  /** The booking is not the conversation's customer's, or does not exist. */
  'not_found',
  /** The booking cannot move: it is over, started, cancelled or declined. */
  'not_changeable',
  /** The conversation reached its limit of booking writes. */
  'too_many_writes',
  /** The customer has not confirmed yet. */
  'not_confirmed',
] as const;
export const bookingToolErrorSchema = z.enum(BOOKING_TOOL_ERRORS);
export type BookingToolError = z.infer<typeof bookingToolErrorSchema>;

// --- arguments -------------------------------------------------------------------------------------------------------

const instant = z.string().datetime({ offset: true });

export const listServicesArgsSchema = z.object({}).strict();

export const checkAvailabilityArgsSchema = z
  .object({
    /** A service id from `list_services`. */
    serviceId: z.string().uuid(),
    /** The first day to look at (`YYYY-MM-DD`, the service's own zone); default today. */
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** How many days to look at, 1 to `BOOKING_TOOL_MAX_DAYS`; default 7. */
    days: z.number().int().min(1).max(BOOKING_TOOL_MAX_DAYS).default(7),
  })
  .strict();

export const bookAppointmentArgsSchema = z
  .object({
    serviceId: z.string().uuid(),
    /** One of the starts `check_availability` returned. */
    startsAt: instant,
    /** The answers to the service's questions, by question id. */
    answers: z.record(z.string().uuid(), z.string().max(2000)).default({}),
    /** Only for a visitor who has no contact yet; ignored when the conversation already has one. */
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(5).max(30).optional(),
    email: z.string().trim().email().max(254).optional(),
    /** The customer said yes to exactly this service and time. A binding refuses `false` with `not_confirmed`. */
    confirmed: z.boolean(),
  })
  .strict();

export const rescheduleAppointmentArgsSchema = z
  .object({
    /** The booking's id, as the customer's own bookings list returns it. */
    appointmentId: z.string().uuid(),
    startsAt: instant,
    confirmed: z.boolean(),
  })
  .strict();

export const BOOKING_TOOL_ARGS = {
  list_services: listServicesArgsSchema,
  check_availability: checkAvailabilityArgsSchema,
  book_appointment: bookAppointmentArgsSchema,
  reschedule_appointment: rescheduleAppointmentArgsSchema,
} as const;

// --- results ---------------------------------------------------------------------------------------------------------

export const bookingToolRefusalSchema = z.object({
  ok: z.literal(false),
  code: bookingToolErrorSchema,
  /** A sentence of ours, in English, for the model to pass on in the customer's language. */
  message: z.string(),
});

const ok = <T extends z.ZodTypeAny>(data: T) => z.object({ ok: z.literal(true), data });

export const listServicesResultSchema = ok(
  z.object({
    services: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        description: z.string().nullable(),
        durationMinutes: z.number().int(),
        locationType: z.enum(['address', 'virtual', 'phone', 'whatsapp']),
        /** What the customer owes to book, as a decimal string in major units ("0.00" when nothing). */
        dueNow: z.string(),
        currency: z.string().nullable(),
        questions: z.array(
          z.object({
            id: z.string().uuid(),
            label: z.string(),
            type: z.string(),
            required: z.boolean(),
            options: z.array(z.string()).nullable(),
          }),
        ),
      }),
    ),
  }),
);

export const checkAvailabilityResultSchema = ok(
  z.object({
    /** The zone the days are cut in; the model shows times in the CUSTOMER's zone, converted from the instants. */
    timezone: z.string(),
    slots: z
      .array(z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() }))
      .max(BOOKING_TOOL_MAX_SLOTS),
    /** More times exist after these: ask again with a later `from`. */
    hasMore: z.boolean(),
  }),
);

export const bookAppointmentResultSchema = ok(
  z.object({
    appointmentId: z.string().uuid(),
    /** `confirmed`, or `pending` (needs approval, or an amount is due first). */
    status: z.enum(['confirmed', 'pending']),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    requiresApproval: z.boolean(),
    /** Set while a payment is due before the booking is confirmed. */
    paymentDue: z.object({ amount: z.string(), currency: z.string().nullable() }).nullable(),
    /** To show to the same customer, in this thread. */
    manageUrl: z.string().url(),
  }),
);

export const rescheduleAppointmentResultSchema = ok(
  z.object({
    appointmentId: z.string().uuid(),
    status: z.enum(['confirmed', 'pending']),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  }),
);

export const BOOKING_TOOL_RESULTS = {
  list_services: listServicesResultSchema,
  check_availability: checkAvailabilityResultSchema,
  book_appointment: bookAppointmentResultSchema,
  reschedule_appointment: rescheduleAppointmentResultSchema,
} as const;

// --- the definitions a model vendor is given -------------------------------------------------------------------------

export interface BookingToolDefinition {
  name: BookingToolName;
  /** For the model: when to use it and what it returns. */
  description: string;
  /** A write stops at the call until the customer has confirmed (rule 2). */
  write: boolean;
  /** JSON Schema of the arguments (OpenAI `parameters`, Anthropic `input_schema`, Gemini `parameters`). */
  parameters: Record<string, unknown>;
}

export const BOOKING_TOOLS: readonly BookingToolDefinition[] = [
  {
    name: 'list_services',
    write: false,
    description:
      'List the services this business takes bookings for, with how long each lasts, what must be paid to book, and the questions to ask. Call this first, before offering times.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'check_availability',
    write: false,
    description: `Get up to ${BOOKING_TOOL_MAX_SLOTS} open times for one service, soonest first. Times are instants; show them in the customer's own time zone. If hasMore is true, call again with a later from date.`,
    parameters: {
      type: 'object',
      properties: {
        serviceId: {
          type: 'string',
          format: 'uuid',
          description: 'A service id from list_services.',
        },
        from: { type: 'string', description: 'First day to look at, YYYY-MM-DD. Default: today.' },
        days: {
          type: 'integer',
          minimum: 1,
          maximum: BOOKING_TOOL_MAX_DAYS,
          description: 'How many days to look at. Default 7.',
        },
      },
      required: ['serviceId'],
      additionalProperties: false,
    },
  },
  {
    name: 'book_appointment',
    write: true,
    description:
      "Book a service at one of the times check_availability returned. Only call this after the customer has clearly said yes to this exact service and time, and set confirmed to true. Ask the service's questions first and pass the answers.",
    parameters: {
      type: 'object',
      properties: {
        serviceId: { type: 'string', format: 'uuid' },
        startsAt: {
          type: 'string',
          format: 'date-time',
          description: 'Exactly one of the times returned by check_availability.',
        },
        answers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Answers by question id.',
        },
        name: {
          type: 'string',
          description: 'Only if the customer is not already known in this conversation.',
        },
        phone: {
          type: 'string',
          description: 'Only if the customer is not already known in this conversation.',
        },
        email: {
          type: 'string',
          description: 'Only if the customer is not already known in this conversation.',
        },
        confirmed: {
          type: 'boolean',
          description: 'True only after the customer said yes to this service and time.',
        },
      },
      required: ['serviceId', 'startsAt', 'confirmed'],
      additionalProperties: false,
    },
  },
  {
    name: 'reschedule_appointment',
    write: true,
    description:
      "Move the customer's own booking to another open time. Only call this after the customer has clearly said yes to the new time, and set confirmed to true.",
    parameters: {
      type: 'object',
      properties: {
        appointmentId: {
          type: 'string',
          format: 'uuid',
          description: "The id of the customer's booking.",
        },
        startsAt: {
          type: 'string',
          format: 'date-time',
          description:
            'Exactly one of the times returned by check_availability for the same service.',
        },
        confirmed: {
          type: 'boolean',
          description: 'True only after the customer said yes to the new time.',
        },
      },
      required: ['appointmentId', 'startsAt', 'confirmed'],
      additionalProperties: false,
    },
  },
];

/**
 * Validates what the model sent for a tool: the typed arguments, or the reason it is wrong (for the model to correct itself). A write whose
 * `confirmed` is not true is `not_confirmed`, never run (rule 2).
 */
export function parseBookingToolCall(
  name: string,
  raw: unknown,
):
  | { ok: true; name: BookingToolName; args: unknown }
  | { ok: false; code: BookingToolError | 'invalid_arguments' | 'unknown_tool'; message: string } {
  if (!(BOOKING_TOOL_NAMES as readonly string[]).includes(name)) {
    return {
      ok: false,
      code: 'unknown_tool',
      message: `There is no tool named ${name.slice(0, 40)}.`,
    };
  }
  const tool = name as BookingToolName;
  const parsed = BOOKING_TOOL_ARGS[tool].safeParse(raw ?? {});
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join('.') || 'arguments';
    return {
      ok: false,
      code: 'invalid_arguments',
      message: `The ${where} argument is missing or not valid.`,
    };
  }
  const args = parsed.data as { confirmed?: boolean };
  if (BOOKING_TOOLS.find((t) => t.name === tool)!.write && args.confirmed !== true) {
    return {
      ok: false,
      code: 'not_confirmed',
      message:
        'The customer has not confirmed this yet. Ask them to confirm the service and time, then call again with confirmed set to true.',
    };
  }
  return { ok: true, name: tool, args: parsed.data };
}
