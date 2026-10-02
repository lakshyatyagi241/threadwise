import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** What the person is told about a failed call, chosen by the API's error `code`, never by its wording. */
export const ERROR_KINDS = [
  'network',
  'forbidden',
  'signedOut',
  'notFound',
  'validation',
  'conflict',
  'rateLimited',
  'planLimit',
  'alreadyMember',
  'cannotGrant',
  'higherRank',
  'ownRole',
  'removeSelf',
  'removeOwner',
  'lastOwner',
  'inviteNotPending',
  'teamNameTaken',
  'teamMemberUnknown',
  'orgSuspended',
  'unexpected',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

const BY_CODE: Record<string, ErrorKind> = {
  [ERROR_CODES.FORBIDDEN]: 'forbidden',
  [ERROR_CODES.UNAUTHENTICATED]: 'signedOut',
  [ERROR_CODES.NOT_FOUND]: 'notFound',
  [ERROR_CODES.VALIDATION_FAILED]: 'validation',
  [ERROR_CODES.ROW_VERSION_CONFLICT]: 'conflict',
  [ERROR_CODES.RATE_LIMITED]: 'rateLimited',
  [ERROR_CODES.PLAN_LIMIT_REACHED]: 'planLimit',
  [ERROR_CODES.WSP_ALREADY_MEMBER]: 'alreadyMember',
  [ERROR_CODES.WSP_CANNOT_GRANT_ROLE]: 'cannotGrant',
  [ERROR_CODES.WSP_CANNOT_ACT_ON_HIGHER_RANK]: 'higherRank',
  [ERROR_CODES.WSP_CANNOT_CHANGE_OWN_ROLE]: 'ownRole',
  [ERROR_CODES.WSP_CANNOT_REMOVE_SELF]: 'removeSelf',
  [ERROR_CODES.WSP_CANNOT_REMOVE_OWNER]: 'removeOwner',
  [ERROR_CODES.WSP_LAST_OWNER]: 'lastOwner',
  [ERROR_CODES.WSP_INVITE_NOT_PENDING]: 'inviteNotPending',
  [ERROR_CODES.WSP_TEAM_NAME_TAKEN]: 'teamNameTaken',
  [ERROR_CODES.WSP_TEAM_MEMBER_UNKNOWN]: 'teamMemberUnknown',
  [ERROR_CODES.WSP_ORG_SUSPENDED]: 'orgSuspended',
};

export function errorKind(error: unknown): ErrorKind {
  // `fetch` rejects with a TypeError when no response arrived at all.
  if (error instanceof TypeError) return 'network';
  if (!(error instanceof ApiError)) return 'unexpected';
  return BY_CODE[error.code] ?? 'unexpected';
}

/** The request id of a failed call, shown with errors nobody can explain so support can find the log line. */
export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;

/** The plan's cap from a PLAN_LIMIT_REACHED answer (`limitValue`); undefined when the server did not say. */
export function planLimitOf(error: unknown): number | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const raw = error.fieldErrors.find((f) => f.path === 'limitValue')?.message;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
