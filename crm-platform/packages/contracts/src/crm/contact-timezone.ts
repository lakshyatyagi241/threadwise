import { z } from 'zod';
import { canonicalZone, isZone, zoneSourceSchema } from '../compliance/send-window';

/**
 * A contact's time zone (BL-193). The quiet hours (BL-177) are read on the contact's own clock; this is the zone a person, an import or
 * an API client can set on the contact, and the record of who set it.
 *
 * `staff`: typed in the app (the contact form, a bulk edit). `import`: a CSV import. `api`: the REST API. A zone read from the country
 * code of the number, or the workspace's fallback, is never stored: it is worked out on every send (the contact's `send-window` says
 * which), so it is always current and a chosen zone is never overwritten by it.
 */
export const CONTACT_TIMEZONE_SOURCES = ['staff', 'import', 'api'] as const;
export const contactTimezoneSourceSchema = z.enum(CONTACT_TIMEZONE_SOURCES);
export type ContactTimezoneSource = z.infer<typeof contactTimezoneSourceSchema>;

/** An IANA zone name the runtime knows, e.g. `Asia/Kolkata` or `America/Sao_Paulo`. */
export const contactTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((v) => isZone(v), { message: 'must be an IANA time zone, for example Asia/Kolkata' })
  // Stored the way the runtime spells it, so `asia/kolkata` and `Asia/Kolkata` are one zone to the filter.
  .transform((v) => canonicalZone(v) ?? v);

/** `GET /v2/contacts/:id/send-window`: the clock a marketing message to this contact is read on, and what the quiet hours say right now. */
export const contactSendWindowSchema = z.object({
  /** The zone stored on the contact and who set it; null when none is stored. */
  timezone: z.string().nullable(),
  timezoneSource: contactTimezoneSourceSchema.nullable(),
  /** The clock marketing messages are read on: the stored zone, else the number's country (possibly several zones), else the fallback. */
  clock: z.object({
    zones: z.array(z.string()),
    /** The one zone to show; null when the number's country spans several. */
    zone: z.string().nullable(),
    source: zoneSourceSchema,
    /** The time now on that clock, `HH:mm`; null when there are several zones. */
    localTime: z.string().nullable(),
  }),
  /** `off`: no quiet hours are switched on. `open`: a marketing message may go now. `held`: it would wait. */
  quietHours: z.enum(['off', 'open', 'held']),
  /** When held: the first instant a marketing message may go (ISO 8601). */
  nextSendAt: z.string().datetime().nullable(),
  /** Messages and recipients already waiting for the quiet hours for this contact, and the first instant one of them goes. */
  heldCount: z.number().int(),
  heldUntil: z.string().datetime().nullable(),
});
export type ContactSendWindow = z.infer<typeof contactSendWindowSchema>;
