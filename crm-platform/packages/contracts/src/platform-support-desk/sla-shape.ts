import { z } from 'zod';

const iso = z.string();
const minutes = z.number().int().min(0);

/** The SLA snapshot a ticket carries (TW-SUPP-014, 029). Kept apart from the board schemas so tickets.ts can embed it. */
export const SLA_SEVERITIES = ['ok', 'warn', 'breach', 'met'] as const;
export const slaTimerSchema = z.object({
  deadline: iso,
  breached: z.boolean(),
  minutesRemaining: minutes.nullable(),
  minutesOver: minutes.nullable(),
  /** `met` once the timer stopped inside its window; `breach` when late or overdue; `warn` inside the last quarter. */
  severity: z.enum(SLA_SEVERITIES),
});
export type SlaTimer = z.infer<typeof slaTimerSchema>;

export const ticketSlaSchema = z.object({
  policy: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  firstResponse: slaTimerSchema.nullable(),
  resolution: slaTimerSchema.nullable(),
});
export type TicketSla = z.infer<typeof ticketSlaSchema>;
