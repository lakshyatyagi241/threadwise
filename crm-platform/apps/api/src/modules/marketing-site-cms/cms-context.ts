import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';

/** The signed-in operator's internal id (an operator route always has one; the guard has already proved it). */
export function operatorId(): number {
  const id = RequestContextStore.require().actorId;
  if (!id) throw AppError.unauthenticated();
  return id;
}

/** A timestamptz from `tx.execute` (a Date or an ISO-ish string) as an ISO string; null stays null. */
export function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Date(value).toISOString();
}

/** A bigint or numeric column from `tx.execute` (a string) as a number. */
export const num = (value: unknown): number => Number(value ?? 0);

/** The audit event for an operator write, written in the same transaction as the change. */
export const CMS_EVENTS = {
  draftSaved: 'platform.cms.draft_saved',
  layoutSaved: 'platform.cms.layout_saved',
  published: 'platform.cms.published',
  discarded: 'platform.cms.discarded',
  reset: 'platform.cms.reset',
  presetApplied: 'platform.cms.preset_applied',
  homepageToggled: 'platform.cms.homepage_toggled',
  legalUpdated: 'platform.cms.legal_updated',
  legalToggled: 'platform.cms.legal_toggled',
  blogCreated: 'platform.cms.blog_created',
  blogUpdated: 'platform.cms.blog_updated',
  blogToggled: 'platform.cms.blog_toggled',
  blogDeleted: 'platform.cms.blog_deleted',
  contactDeleted: 'platform.cms.contact_deleted',
  faqChanged: 'platform.cms.faq_changed',
  announcementChanged: 'platform.cms.announcement_changed',
  guidebookChanged: 'platform.cms.guidebook_changed',
} as const;
