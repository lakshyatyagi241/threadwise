import type { ConsentAction } from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';

/** The channels a contact record carries a subscription status for; the Contact details rows record consent on these. */
export type SubscriptionChannel = 'whatsapp' | 'email' | 'sms';

/**
 * The contract types the consent view but has no schema for it. The app only needs to know the write was accepted (the contact is
 * read again afterwards), so the check is the part of the view every answer carries.
 */
const consentViewSchema = z.looseObject({ contactId: z.string(), optedOut: z.boolean() });

/**
 * Records that a contact agreed to, or withdrew from, marketing on one channel: the web's "Mark as subscribed / unsubscribed" on the
 * Consent card. A grant needs a note (what the person said or signed, and where); the API refuses it without one.
 */
export const recordConsent = (
  contactId: string,
  body: { channel: SubscriptionChannel; action: ConsentAction; note?: string },
  idempotencyKey?: string,
) =>
  apiFetch(`/v2/contact-consent/contacts/${contactId}/events`, {
    method: 'POST',
    body: { ...body, source: 'manual' },
    schema: consentViewSchema,
    idempotencyKey,
  });
