import type {
  ProviderSummary,
  SwitchNumberOutcome,
  SwitchRequirement,
  SwitchWorkspaceProviderInput,
  SwitchWorkspaceProviderResponse,
} from '@crm/contracts';

/**
 * The switch flow's view-model: the request the form builds, what a dry run says in numbers, what an applied switch did, and the
 * rollback it offers. Pure, so the screen only renders it.
 */

export interface SwitchForm {
  targetProviderId: string;
  /** Empty: every number not already on the target. */
  fromProviderId: string;
  setOverride: boolean;
  reason: string;
}

/** The API refuses a switch of more numbers than this in one request (422 on `numberIds`): narrow it with a source provider. */
export const MAX_SWITCH_NUMBERS = 50;

/** True when the form says enough to ask the API for a dry run. */
export const canDryRun = (workspaceId: string, f: SwitchForm): boolean =>
  workspaceId !== '' && f.targetProviderId !== '' && f.targetProviderId !== f.fromProviderId;

/**
 * The switch request. A dry run never carries `setOverride` or a reason's effect (the API ignores them), but they are sent
 * as typed so the apply request is the dry run's request plus `dryRun: false` and the chosen numbers.
 */
export function buildSwitchRequest(
  f: SwitchForm,
  opts: { dryRun: boolean; numberIds?: readonly string[] },
): SwitchWorkspaceProviderInput {
  const body: SwitchWorkspaceProviderInput = {
    targetProviderId: f.targetProviderId,
    dryRun: opts.dryRun,
    setOverride: f.setOverride,
  };
  if (f.fromProviderId) body.fromProviderId = f.fromProviderId;
  if (opts.numberIds && opts.numberIds.length > 0) body.numberIds = [...opts.numberIds];
  const reason = f.reason.trim();
  if (reason) body.reason = reason;
  return body;
}

/** A key that changes whenever an input of the form does, so a stale dry run is never applied. */
export const formSignature = (workspaceId: string, f: SwitchForm): string =>
  JSON.stringify([
    workspaceId,
    f.targetProviderId,
    f.fromProviderId,
    f.setOverride,
    f.reason.trim(),
  ]);

export interface PlanSummary {
  total: number;
  ready: number;
  blocked: number;
  /** Numbers that are disconnected: re-pointed only, they need a reconnect before they can send. */
  needReconnect: number;
  /** How many numbers have each requirement. */
  requirements: Partial<Record<SwitchRequirement, number>>;
  /** Connection ids that would move (`ready`), in the order the API listed them. */
  readyIds: string[];
  /** Numbers the API could not even assess (it says why in `message`); they are not moved. */
  failed: number;
  /** At least one number would move, so the operator can go on to apply. */
  canApply: boolean;
}

export function summarizePlan(r: SwitchWorkspaceProviderResponse): PlanSummary {
  const requirements: Partial<Record<SwitchRequirement, number>> = {};
  for (const n of r.numbers) {
    for (const req of n.requirements) requirements[req] = (requirements[req] ?? 0) + 1;
  }
  const ready = r.numbers.filter((n) => n.state === 'ready');
  return {
    total: r.numbers.length,
    ready: ready.length,
    blocked: r.numbers.filter((n) => n.state === 'blocked').length,
    needReconnect: requirements.reconnect_needed ?? 0,
    requirements,
    readyIds: ready.map((n) => n.numberId),
    failed: r.numbers.filter((n) => n.state === 'failed').length,
    canApply: ready.length > 0,
  };
}

/** Requirements that stop a number from moving (the rest are advice: a disconnected number is still re-pointed). */
export const BLOCKING_REQUIREMENTS: readonly SwitchRequirement[] = [
  'number_token_needed',
  'provider_token_needed',
  'ids_missing',
];

export const isBlockingRequirement = (r: SwitchRequirement): boolean =>
  BLOCKING_REQUIREMENTS.includes(r);

/** Which of the dry run's numbers the operator may tick: the ones that would move. */
export const selectableNumbers = (r: SwitchWorkspaceProviderResponse): SwitchNumberOutcome[] =>
  r.numbers.filter((n) => n.state === 'ready');

/**
 * The ids to send when applying: undefined (every number the API would pick) when the whole ready set is ticked, otherwise exactly
 * the ticked ones. Never an empty list: the API refuses it.
 */
export function numberIdsToApply(
  plan: PlanSummary,
  ticked: ReadonlySet<string>,
): string[] | undefined {
  const chosen = plan.readyIds.filter((id) => ticked.has(id));
  if (chosen.length === 0) return undefined;
  return chosen.length === plan.readyIds.length ? undefined : chosen;
}

export interface ResultSummary {
  total: number;
  switched: number;
  repointed: number;
  failed: number;
  blocked: number;
  /** Numbers that moved but whose per-number callback was not accepted: the app-level callback must be set. */
  inboundNotWired: number;
  /** Every number that was attempted moved (nothing failed or stayed blocked). */
  allMoved: boolean;
  /** Nothing moved at all. */
  noneMoved: boolean;
  /** The providers the moved numbers came from, to roll back to. */
  rollbackTargets: ProviderSummary[];
}

export function summarizeResult(r: SwitchWorkspaceProviderResponse): ResultSummary {
  const count = (state: SwitchNumberOutcome['state']) =>
    r.numbers.filter((n) => n.state === state).length;
  const moved = r.numbers.filter((n) => n.state === 'switched' || n.state === 'repointed');
  const targets = new Map<string, ProviderSummary>();
  for (const n of moved) if (n.from) targets.set(n.from.id, n.from);
  const switched = count('switched');
  const repointed = count('repointed');
  return {
    total: r.numbers.length,
    switched,
    repointed,
    failed: count('failed'),
    blocked: count('blocked'),
    inboundNotWired: r.numbers.filter((n) => n.state === 'switched' && n.inboundWired === false)
      .length,
    allMoved: moved.length === r.numbers.length && r.numbers.length > 0,
    noneMoved: moved.length === 0,
    rollbackTargets: [...targets.values()],
  };
}

/**
 * Rolling back is switching back: the same workspace, the previous provider as the target, and only what was moved (the provider
 * it moved TO as the source). Null when no number moved, so there is nothing to undo.
 */
export function rollbackForm(
  result: SwitchWorkspaceProviderResponse,
  previous: ProviderSummary,
): SwitchForm | null {
  const summary = summarizeResult(result);
  if (summary.noneMoved) return null;
  return {
    targetProviderId: previous.id,
    fromProviderId: result.to.id,
    setOverride: false,
    reason: '',
  };
}

/** The i18n key (under `whatsapp-providers.switch.requirements`) that explains each requirement. */
export const REQUIREMENT_KEYS: Readonly<Record<SwitchRequirement, string>> = {
  number_token_needed: 'numberToken',
  provider_token_needed: 'providerToken',
  ids_missing: 'idsMissing',
  reconnect_needed: 'reconnect',
};
