import { z } from 'zod';
import { contactSelectionShape, hasExactlyOneSelector, SELECTION_REFINEMENT } from '../contacts-attributes-tags/contact-filter';

/** The contact buttons a person can press. The web reports the press; what it does is decided by the workspace's settings. */
export const CONTACT_TOUCH_CHANNELS = ['call', 'sms', 'email', 'whatsapp'] as const;
export type ContactTouchChannel = (typeof CONTACT_TOUCH_CHANNELS)[number];

/** `POST /contacts/:id/touch`: "I pressed Call / SMS / Email / WhatsApp on this contact". */
export const touchContactSchema = z.object({ channel: z.enum(CONTACT_TOUCH_CHANNELS) });
export type TouchContactInput = z.infer<typeof touchContactSchema>;

export interface TouchContactResponse {
  /** The contact's marker after the press. */
  uncontacted: boolean;
}

/** `PUT /contacts/:id/uncontacted`: mark a contact as uncontacted (`true`) or as contacted (`false`) by hand. */
export const setUncontactedSchema = z.object({ uncontacted: z.boolean() });
export type SetUncontactedInput = z.infer<typeof setUncontactedSchema>;

/** `POST /contacts/bulk/uncontacted`: the same for a selection (ids, or everything matching a filter). */
export const bulkSetUncontactedSchema = z
  .object({ ...contactSelectionShape, uncontacted: z.boolean() })
  .refine(hasExactlyOneSelector, SELECTION_REFINEMENT);
export type BulkSetUncontactedInput = z.infer<typeof bulkSetUncontactedSchema>;

/** Why a marker moved, as written to the audit trail and the `contact.uncontacted_changed` event. */
export const UNCONTACTED_CAUSES = [
  'manual',
  'contact_button',
  'message',
  'automation',
  'activity',
  'new_manual',
  'new_import',
  'new_lead_source',
  'reassign',
] as const;
export type UncontactedCause = (typeof UNCONTACTED_CAUSES)[number];
