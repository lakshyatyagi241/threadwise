import type {
  WizardAudienceCount,
  WizardEligibility,
  WizardEligibilityCheck,
  WizardEligibilityCode,
  WizardEligibilityGroup,
  WizardEligibilityState,
} from '@crm/contracts';

/** The pure rules of the step 3 eligibility check. Nothing here reads a database or a clock it was not given. */

const ORDER: Record<WizardEligibilityState, number> = { pass: 0, warn: 1, fail: 2 };

const row = (
  code: WizardEligibilityCode,
  state: WizardEligibilityState,
  values: WizardEligibilityCheck['values'] = {},
): WizardEligibilityCheck => ({ code, state, values });

export const worstState = (states: readonly WizardEligibilityState[]): WizardEligibilityState =>
  states.reduce<WizardEligibilityState>((w, s) => (ORDER[s] > ORDER[w] ? s : w), 'pass');

/** A group: its worst row decides the state and the one-line reason; when everything passes, `summary` speaks for the group. */
function group(
  key: WizardEligibilityGroup['group'],
  checks: WizardEligibilityCheck[],
  summary: WizardEligibilityCheck,
  chips: WizardEligibilityGroup['chips'] = [],
): WizardEligibilityGroup {
  const state = worstState(checks.map((c) => c.state));
  const head =
    checks.find((c) => c.state === 'fail') ?? checks.find((c) => c.state === 'warn') ?? summary;
  return { group: key, state, code: head.code, values: head.values, checks, chips };
}

// ------------------------------------------------------------------------------------------------ contacts

export function contactsGroup(input: {
  hasSource: boolean;
  count: WizardAudienceCount;
  /** Memberships beyond the first: contacts that were in more than one source (or twice in the CSV) and are messaged once. */
  duplicates: number;
}): WizardEligibilityGroup {
  const { count } = input;
  const skipped = count.optedOut + count.invalidNumber;
  const values = { eligible: count.recipients, selected: count.matching, skipped };
  const chips: WizardEligibilityGroup['chips'] = [
    { key: 'eligible', count: count.recipients },
    { key: 'selected', count: count.matching },
    { key: 'optedOut', count: count.optedOut },
    { key: 'invalidNumber', count: count.invalidNumber },
    { key: 'duplicate', count: input.duplicates },
  ];
  let verdict: WizardEligibilityCheck;
  if (!input.hasSource) verdict = row('contacts_no_audience', 'fail');
  else if (count.recipients === 0) verdict = row('contacts_none_eligible', 'fail', values);
  else if (count.approximate) verdict = row('contacts_approximate', 'warn', values);
  else if (skipped > 0) verdict = row('contacts_some_skipped', 'warn', values);
  else verdict = row('contacts_ok', 'pass', values);
  return group('contacts', [verdict], row('contacts_ok', 'pass', values), chips);
}

// ------------------------------------------------------------------------------------------------ template and sender

export interface TemplateFacts {
  templateType: string;
  /** `wa_templates.status`: approved or public can be sent. */
  status: string | null;
  metaTemplateId: string | null;
  metaStatus: string | null;
  pausedUntil: Date | null;
  qualityScore: string | null;
  /** The WhatsApp Business Account of the number the template is tied to, when that is recorded. */
  ownWabaId: string | null;
}

export interface SenderFacts {
  /** The number is connected (the same lookup the launch uses). */
  connected: boolean;
  label: string | null;
  /** The WhatsApp Business Account of the number, when recorded. */
  wabaId: string | null;
  /** Meta's number status as the channel last recorded it (RESTRICTED, FLAGGED, ...), when recorded. */
  phoneStatus: string | null;
  /** Meta's quality rating of the number as stored (GREEN, YELLOW, RED), when stored. */
  qualityRating: string | null;
}

const SENDABLE = new Set(['approved', 'public']);
const BLOCKING_PHONE = new Set(['BANNED', 'DELETED', 'MIGRATED', 'RESTRICTED']);
const WARNING_PHONE = new Set(['FLAGGED', 'PENDING', 'RATE_LIMITED']);

export function templateGroup(input: {
  template: TemplateFacts;
  sender: SenderFacts;
  unmappedSlots: number;
  now: Date;
}): WizardEligibilityGroup {
  const checks: WizardEligibilityCheck[] = [];
  const t = input.template;
  if (t.templateType === 'auth') {
    checks.push(row('template_auth_not_allowed', 'fail'));
  } else {
    const status = t.status ?? '';
    const meta = (t.metaStatus ?? '').toUpperCase();
    if (!SENDABLE.has(status.toLowerCase())) {
      checks.push(row('template_not_approved', 'fail', { status }));
    } else if (t.metaTemplateId && meta !== 'APPROVED') {
      checks.push(row('template_not_approved', 'fail', { status: meta || 'unknown' }));
    } else if (t.pausedUntil && t.pausedUntil.getTime() > input.now.getTime()) {
      checks.push(
        row('template_paused', 'fail', { until: t.pausedUntil.toISOString().slice(0, 16) }),
      );
    } else if (t.metaTemplateId && (t.qualityScore ?? '').toUpperCase() === 'RED') {
      checks.push(row('template_quality_low', 'fail'));
    } else {
      checks.push(row('template_ok', 'pass'));
    }
  }

  const s = input.sender;
  const label = s.label ?? '';
  if (!s.connected) {
    checks.push(row('sender_not_connected', 'fail'));
  } else {
    const phone = (s.phoneStatus ?? '').toUpperCase();
    if (BLOCKING_PHONE.has(phone)) checks.push(row('sender_restricted', 'fail', { status: phone }));
    else if (WARNING_PHONE.has(phone))
      checks.push(row('sender_flagged', 'warn', { status: phone }));
    else if ((s.qualityRating ?? '').toUpperCase() === 'RED')
      checks.push(row('sender_quality_low', 'warn'));
    else checks.push(row('sender_ok', 'pass', { label }));
  }

  // A template exists inside one WhatsApp Business Account: another account's number cannot send it. Only said when both are recorded.
  if (s.connected && t.ownWabaId && s.wabaId && t.ownWabaId !== s.wabaId) {
    checks.push(row('template_other_sender', 'fail'));
  }

  checks.push(
    input.unmappedSlots > 0
      ? row('variables_incomplete', 'fail', { missing: input.unmappedSlots })
      : row('variables_ok', 'pass'),
  );
  return group('template', checks, row('template_group_ok', 'pass'));
}

// ------------------------------------------------------------------------------------------------ billing

export interface BillingFacts {
  /** The balance could not be read: nothing else is known. */
  unavailable: boolean;
  billingMode: 'plan' | 'wallet';
  planActive: boolean;
  monthlyLimit: number;
  usedThisMonth: number;
  recipients: number;
  chargeableMessages: number;
  estimatedCostMinor: number;
  balanceMinor: number;
  currency: string;
  walletExists: boolean;
  /** The wallet's own launch rule (`launchVerdict` through the gate): `null` when the send may start. */
  refusal: 'empty' | 'insufficient' | null;
}

export function billingGroup(f: BillingFacts): WizardEligibilityGroup {
  if (f.unavailable) {
    const down = row('billing_unavailable', 'fail');
    return group('billing', [down], down);
  }
  const remaining = Math.max(0, f.monthlyLimit - f.usedThisMonth);
  const money = { balanceMinor: f.balanceMinor, currency: f.currency };
  let mode: WizardEligibilityCheck;
  if (f.billingMode === 'wallet') mode = row('billing_mode_wallet', 'pass');
  else if (!f.planActive) mode = row('billing_mode_plan_inactive', 'pass');
  else if (f.monthlyLimit <= 0) mode = row('billing_mode_plan_unlimited', 'pass');
  else
    mode = row('billing_mode_plan', 'pass', {
      remaining,
      limit: f.monthlyLimit,
      used: f.usedThisMonth,
    });

  const wallet = f.walletExists
    ? row('billing_wallet_present', 'pass', money)
    : row('billing_wallet_none', f.chargeableMessages > 0 ? 'warn' : 'pass', money);

  const spend = {
    ...money,
    chargeable: f.chargeableMessages,
    estimatedMinor: f.estimatedCostMinor,
    recipients: f.recipients,
    remaining,
  };
  let verdict: WizardEligibilityCheck;
  if (f.refusal === 'empty') verdict = row('billing_wallet_empty', 'fail', spend);
  else if (f.refusal === 'insufficient')
    verdict = row('billing_wallet_insufficient', 'fail', spend);
  else if (f.billingMode === 'plan' && f.planActive && f.chargeableMessages > 0)
    verdict = row('billing_allowance_runs_out', 'warn', spend);
  else verdict = row('billing_ok', 'pass', spend);

  return group('billing', [mode, wallet, verdict], mode);
}

export function eligibilityOf(parts: {
  contacts: WizardEligibilityGroup;
  template: WizardEligibilityGroup;
  billing: WizardEligibilityGroup;
}): WizardEligibility {
  return {
    ...parts,
    state: worstState([parts.contacts.state, parts.template.state, parts.billing.state]),
  };
}
