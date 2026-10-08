import { DEVICE_NAME_MAX, DEVICE_NAME_MIN, PERSONAL_WA_NOTICE_ITEM_IDS } from '@crm/contracts';
import { readDevicePhone, type DevicePhone } from './phone-model';

/** The four steps of "Connect a number" (spec 13.2). */
export type WizardStep = 'notice' | 'number' | 'link' | 'done';
export const WIZARD_STEPS: readonly WizardStep[] = ['notice', 'number', 'link', 'done'];

/** The three acknowledgements, ticked one by one (no "agree to all", never pre-ticked). */
export const NOTICE_ITEMS: number = PERSONAL_WA_NOTICE_ITEM_IDS.length;
export type Acks = readonly [boolean, boolean, boolean];
export const NO_ACKS: Acks = [false, false, false];

export const NAME_MIN: number = DEVICE_NAME_MIN;
export const NAME_MAX: number = DEVICE_NAME_MAX;

export interface WizardDraft {
  acks: Acks;
  name: string;
  /** What the phone field produced (E.164), or null while empty or invalid. */
  e164: string | null;
  /** The person typed something that is not a valid number. */
  phoneInvalid: boolean;
  activateAfterPairing: boolean;
}

export const EMPTY_DRAFT: WizardDraft = {
  acks: NO_ACKS,
  name: '',
  e164: null,
  phoneInvalid: false,
  activateAfterPairing: true,
};

export const allAcknowledged = (acks: readonly boolean[]): boolean =>
  acks.length >= NOTICE_ITEMS && acks.slice(0, NOTICE_ITEMS).every(Boolean);

export const tick = (acks: Acks, index: number, value: boolean): Acks =>
  acks.map((v, i) => (i === index ? value : v)) as unknown as Acks;

/**
 * Where the wizard opens. A brand-new number starts at the notice unless the caller already accepted the current version
 * (then at the number step); an existing number (reconnect) skips the number step, and the notice too when accepted.
 */
export function firstStep(input: { noticeAccepted: boolean; existingDevice: boolean }): WizardStep {
  if (!input.noticeAccepted) return 'notice';
  return input.existingDevice ? 'link' : 'number';
}

export type NameProblem = 'required' | 'short' | 'long';
export function nameProblem(name: string): NameProblem | null {
  const n = name.trim();
  if (!n) return 'required';
  if (n.length < NAME_MIN) return 'short';
  if (n.length > NAME_MAX) return 'long';
  return null;
}

export interface NumberProblems {
  name: NameProblem | null;
  phone: 'empty' | 'invalid' | null;
}

export function numberProblems(draft: WizardDraft): NumberProblems {
  const phone: DevicePhone = readDevicePhone(draft.e164);
  return {
    name: nameProblem(draft.name),
    phone: phone.ok ? null : draft.phoneInvalid ? 'invalid' : phone.problem,
  };
}

/** Whether the "Continue" button of a step is enabled. The link and done steps have their own buttons. */
export function canContinue(step: WizardStep, draft: WizardDraft): boolean {
  if (step === 'notice') return allAcknowledged(draft.acks);
  if (step === 'number') {
    const p = numberProblems(draft);
    return p.name === null && p.phone === null;
  }
  return false;
}

/**
 * The wizard holds something worth keeping: a ticked box, a typed name or number, or an attempt in progress. Closing it then asks
 * first. An attempt that has finished (connected or ended) is not unsaved work.
 */
export function isDirty(input: {
  draft: WizardDraft;
  step: WizardStep;
  attemptActive: boolean;
  /** The number step created the device already: closing leaves a row behind, which the list shows. */
  deviceCreated: boolean;
}): boolean {
  if (input.step === 'done') return false;
  if (input.attemptActive) return true;
  if (input.deviceCreated) return false;
  const d = input.draft;
  return d.acks.some(Boolean) || d.name.trim() !== '' || d.e164 !== null;
}
