import {
  LEAD_HOOK_SECRET_HEADER,
  type LeadHookBaseProblem,
  type LeadSourceSecretsResponse,
} from '@crm/contracts';

/**
 * The one-time reveal of a source's token and URL (create, rotate). It is a tiny state machine held ONLY in component state: never
 * in the query cache, never in storage, never in the address, never logged. It goes away only after the person confirms they copied
 * it; a call to `dismissReveal` without that confirmation keeps it, so no code path can drop the token by accident.
 */

export type RevealReason = 'created' | 'rotated';

export interface Reveal {
  token: string;
  hookPath: string;
  /** The complete public address the server built, or null when it could not (see `hookUrlProblem`). */
  hookUrl: string | null;
  hookUrlProblem: LeadHookBaseProblem | null;
  reason: RevealReason;
  /** The person ticked "I have copied it". */
  confirmed: boolean;
}

export const revealOf = (secrets: LeadSourceSecretsResponse, reason: RevealReason): Reveal => ({
  token: secrets.token,
  hookPath: secrets.hookPath,
  hookUrl: secrets.hookUrl,
  hookUrlProblem: secrets.hookUrlProblem,
  reason,
  confirmed: false,
});

export const confirmReveal = (reveal: Reveal, confirmed: boolean): Reveal => ({
  ...reveal,
  confirmed,
});

export const canDismiss = (reveal: Reveal | null): boolean => reveal !== null && reveal.confirmed;

/** Null only when the person confirmed; otherwise the reveal is returned unchanged. */
export const dismissReveal = (reveal: Reveal | null): Reveal | null =>
  reveal && !reveal.confirmed ? reveal : null;

/** True while leaving the page would lose a token nobody has confirmed copying: the page asks before it unloads. */
export const needsLeaveGuard = (reveal: Reveal | null): boolean => reveal !== null;

/** What a sender can paste to try the hook. The numbers are the fictional 202-555-01xx range. */
export function sampleCurl(url: string | null, hasSecret: boolean): string {
  const lines = [`curl -X POST '${url ?? '<your-api-address>/v2/public/lead-hooks/<token>'}'`];
  lines.push("  -H 'Content-Type: application/json'");
  if (hasSecret) lines.push(`  -H '${LEAD_HOOK_SECRET_HEADER}: <your shared secret>'`);
  lines.push(`  -d '{"name":"Test Lead","email":"test.lead@example.test","phone":"+12025550123"}'`);
  return lines.join(' \\\n');
}
