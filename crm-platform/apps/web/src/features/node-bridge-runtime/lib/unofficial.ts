/**
 * The unofficial WhatsApp switch on the Node bridge page (owner decision 2026-10-05: only the official WhatsApp Business API is
 * supported; personal numbers paired by QR are off unless a super admin turns them on).
 */

/** What a super admin types to turn the unofficial engine ON. Turning it off needs only a confirmation. */
export const ENABLE_PHRASE = 'ENABLE';

export type UnofficialView = {
  /** Message key suffix under `unofficial.status.*` and `unofficial.state.*`. */
  status: 'disabled' | 'enabled';
  /** Badge tone: off is the supported state, on is the warned one. */
  tone: 'success' | 'warning';
  /** The rest of the page (bridge URL, token, pacing) is shown but dimmed while the engine is off. */
  dimRest: boolean;
  /** What the button asks for: the opposite of the current state. */
  next: boolean;
};

export function unofficialView(enabled: boolean): UnofficialView {
  return enabled
    ? { status: 'enabled', tone: 'warning', dimRest: false, next: false }
    : { status: 'disabled', tone: 'success', dimRest: true, next: true };
}

/** Case-insensitive, ignoring surrounding spaces: the phrase the dialog asks for. */
export const phraseOk = (typed: string, phrase: string = ENABLE_PHRASE): boolean =>
  typed.trim().toLowerCase() === phrase.toLowerCase();
