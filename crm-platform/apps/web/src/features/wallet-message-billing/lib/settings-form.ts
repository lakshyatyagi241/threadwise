import {
  updateWalletSettingsSchema,
  walletMinorToMajor,
  type UpdateWalletSettingsInput,
  type WalletSettings,
} from '@crm/contracts';
import { parseAmount } from './money';

export interface SettingsDraft {
  flatPrice: string;
  referralSignup: string;
  lowBalanceThreshold: string;
  launchCoveragePercent: string;
}

export type SettingsField = keyof SettingsDraft;
export type SettingsProblem = 'invalid' | 'flatZero' | 'percent';

export const toDraft = (s: WalletSettings): SettingsDraft => ({
  flatPrice: walletMinorToMajor(s.flatPriceMinor),
  referralSignup: walletMinorToMajor(s.referralSignupMinor),
  lowBalanceThreshold: walletMinorToMajor(s.lowBalanceThresholdMinor),
  launchCoveragePercent: String(s.launchCoveragePercent),
});

export interface SettingsCheck {
  input: UpdateWalletSettingsInput | null;
  problems: Partial<Record<SettingsField, SettingsProblem>>;
}

/** Checks the economics form with the contract's schema; money stays text. The server is still the authority. */
export function checkSettings(d: SettingsDraft): SettingsCheck {
  const problems: SettingsCheck['problems'] = {};
  const flat = parseAmount(d.flatPrice);
  if (flat === null) problems.flatPrice = 'invalid';
  else if (flat < 1) problems.flatPrice = 'flatZero';
  if (parseAmount(d.referralSignup) === null) problems.referralSignup = 'invalid';
  if (parseAmount(d.lowBalanceThreshold) === null) problems.lowBalanceThreshold = 'invalid';
  const pct = d.launchCoveragePercent.trim();
  if (!/^\d{1,3}$/.test(pct) || Number(pct) > 100) problems.launchCoveragePercent = 'percent';

  const parsed = updateWalletSettingsSchema.safeParse({
    flatPrice: d.flatPrice,
    referralSignup: d.referralSignup,
    lowBalanceThreshold: d.lowBalanceThreshold,
    launchCoveragePercent: Number(pct),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && field in d && !problems[field as SettingsField]) {
        problems[field as SettingsField] = field === 'launchCoveragePercent' ? 'percent' : 'invalid';
      }
    }
  }
  return {
    input: Object.keys(problems).length === 0 && parsed.success ? parsed.data : null,
    problems,
  };
}

/** True when any figure differs from what is stored (compared as hundredths, so "12" equals "12.00"). */
export function settingsDirty(d: SettingsDraft, s: WalletSettings): boolean {
  return (
    parseAmount(d.flatPrice) !== s.flatPriceMinor ||
    parseAmount(d.referralSignup) !== s.referralSignupMinor ||
    parseAmount(d.lowBalanceThreshold) !== s.lowBalanceThresholdMinor ||
    d.launchCoveragePercent.trim() !== String(s.launchCoveragePercent)
  );
}

/** "Real spending": how many messages 100.00 buys at the flat price. */
export const messagesPer100 = (flatPriceMinor: number): number =>
  flatPriceMinor > 0 ? Math.floor(10_000 / flatPriceMinor) : 0;

/** How many messages the referral reward pays for at the flat price. */
export const rewardMessages = (rewardMinor: number, flatPriceMinor: number): number =>
  flatPriceMinor > 0 ? Math.floor(rewardMinor / flatPriceMinor) : 0;
