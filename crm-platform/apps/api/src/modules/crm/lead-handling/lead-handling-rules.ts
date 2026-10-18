import type { UncontactedSettingsValues } from '@crm/contracts';

/**
 * Pure rules of lead handling (docs/specs/lead-followup-settings.md), kept out of the services so a unit test can pin them without a
 * database.
 */

/** What reached out to the contact. Each is one toggle of the "mark as contacted" group. */
export type TouchSource = 'contact_button' | 'message' | 'automation' | 'activity';

/** How a contact came to exist. Each is one toggle of the "mark new contacts as uncontacted" group. */
export type CreateMethod = 'manual' | 'import' | 'lead_source';

/** Does this kind of touch clear the marker in this workspace? */
export function clearsOn(s: UncontactedSettingsValues, source: TouchSource): boolean {
  switch (source) {
    case 'contact_button':
      return s.clearOn.contactButton;
    case 'message':
      return s.clearOn.message;
    case 'automation':
      return s.clearOn.automation;
    case 'activity':
      return s.clearOn.activity;
  }
}

/** Does a contact created this way start uncontacted in this workspace? */
export function marksNew(s: UncontactedSettingsValues, method: CreateMethod): boolean {
  switch (method) {
    case 'manual':
      return s.markNew.manual;
    case 'import':
      return s.markNew.import;
    case 'lead_source':
      return s.markNew.leadSource;
  }
}

/**
 * The creation method of a contact made through `ContactsService.createOrMatch`: a person in the app is manual; an API key or a channel
 * partner is an external system pushing a lead in. Anything else (a public booking page, a worker) is none of the three methods the
 * settings name, so the contact is not marked. (An import or the Sheets add-on say so themselves.)
 */
export function createMethodOfActor(actorType: string): CreateMethod | null {
  if (actorType === 'user') return 'manual';
  if (actorType === 'api_key' || actorType === 'partner_agent') return 'lead_source';
  return null;
}

/**
 * A call counts as reaching out when a person placed it (an unanswered attempt counts, like pressing the Call button does) or talked to
 * the contact (an inbound call that was answered). A missed inbound call, a call nobody handled, and a call that failed or reached the
 * wrong number are not.
 */
export function callReachedContact(c: {
  handlerUserId: number | string | null | undefined;
  direction: string;
  outcome: string;
}): boolean {
  if (c.handlerUserId === null || c.handlerUserId === undefined) return false;
  if (c.outcome === 'failed' || c.outcome === 'wrong_number') return false;
  return c.direction === 'outbound' || c.outcome === 'connected';
}
