/**
 * Error codes of the workspaces-teams-tenancy domain (WSP). The frontend switches on these, never on the message.
 * Role grants, a member changing their own role and the last Owner are RBAC's rules and answer with RBAC's codes
 * (`RBAC_ROLE_GRANT_FORBIDDEN`, `RBAC_SELF_ROLE_CHANGE`, `RBAC_LAST_OWNER`); only the member-lifecycle rules are WSP's.
 */
export const WSP_ERROR_CODES = {
  WSP_ALREADY_MEMBER: 'WSP_ALREADY_MEMBER',
  WSP_CANNOT_ACT_ON_HIGHER_RANK: 'WSP_CANNOT_ACT_ON_HIGHER_RANK',
  WSP_CANNOT_REMOVE_SELF: 'WSP_CANNOT_REMOVE_SELF',
  WSP_CANNOT_REMOVE_OWNER: 'WSP_CANNOT_REMOVE_OWNER',
  WSP_INVITE_INVALID: 'WSP_INVITE_INVALID',
  WSP_INVITE_NOT_PENDING: 'WSP_INVITE_NOT_PENDING',
  WSP_TEAM_NAME_TAKEN: 'WSP_TEAM_NAME_TAKEN',
  WSP_TEAM_MEMBER_UNKNOWN: 'WSP_TEAM_MEMBER_UNKNOWN',
  WSP_ORG_SUSPENDED: 'WSP_ORG_SUSPENDED',
  WSP_WORKSPACE_LIMIT_REACHED: 'WSP_WORKSPACE_LIMIT_REACHED',
  WSP_SLUG_TAKEN: 'WSP_SLUG_TAKEN',
  WSP_IMPERSONATION_REASON_REQUIRED: 'WSP_IMPERSONATION_REASON_REQUIRED',
  /** A read-only impersonation session tried a write. */
  WSP_IMPERSONATION_READ_ONLY: 'WSP_IMPERSONATION_READ_ONLY',
  /** An impersonation session tried something only the owner may do themselves (password, 2FA, API keys, /platform...). */
  WSP_IMPERSONATION_FORBIDDEN: 'WSP_IMPERSONATION_FORBIDDEN',
  /** The workspace has no active owner to act as. */
  WSP_IMPERSONATION_NO_OWNER: 'WSP_IMPERSONATION_NO_OWNER',
  /** The handoff code is unknown, used, expired or its session ended. */
  WSP_IMPERSONATION_CODE_INVALID: 'WSP_IMPERSONATION_CODE_INVALID',
  /** The session the act-as token names has ended or run out. */
  WSP_IMPERSONATION_ENDED: 'WSP_IMPERSONATION_ENDED',
} as const;
