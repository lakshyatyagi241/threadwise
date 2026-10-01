import type { ProfileResponse, UpdateProfileRequest } from '@crm/contracts';
import { modernZoneId } from '../../shared/timezones';

/** What the form holds right now. Strings are raw input; `phone` is already E.164 (or null). */
export interface ProfileDraft {
  fullName: string;
  displayName: string;
  phone: string | null;
  /** '' = "use the default". */
  locale: string;
  theme: ProfileResponse['theme'];
  zone: string;
}

/** The workspace timezone as the picker shows it (old aliases mapped to their modern id). */
export function savedZone(profile: Pick<ProfileResponse, 'workspaceTimezone'>): string {
  return profile.workspaceTimezone ? modernZoneId(profile.workspaceTimezone) : '';
}

/**
 * Only the fields that differ from the saved profile, so saving never overwrites
 * something the person did not touch. A blank display name clears it (null), a
 * blank locale goes back to the default (null), and the workspace timezone is
 * only sent by someone allowed to change it.
 */
export function profileChanges(
  profile: ProfileResponse,
  draft: ProfileDraft,
): UpdateProfileRequest {
  const body: UpdateProfileRequest = {};
  if (draft.fullName.trim() !== profile.fullName) body.fullName = draft.fullName.trim();
  if ((draft.displayName.trim() || null) !== profile.displayName) {
    body.displayName = draft.displayName.trim() || null;
  }
  if (draft.phone !== profile.phone) body.phone = draft.phone;
  if ((draft.locale || null) !== profile.locale) body.locale = draft.locale || null;
  if (draft.theme !== profile.theme) body.theme = draft.theme;
  if (profile.canEditWorkspaceTimezone && draft.zone && draft.zone !== savedZone(profile)) {
    body.workspaceTimezone = draft.zone;
  }
  return body;
}
