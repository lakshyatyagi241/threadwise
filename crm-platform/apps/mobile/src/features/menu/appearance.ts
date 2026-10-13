import type { SessionResponse } from '@crm/contracts';

/** The colour schemes the app can be forced into. */
export type Scheme = 'light' | 'dark';

/** The choices the Appearance screen offers: a fixed scheme, or whatever the phone is set to. */
export type Mode = Scheme | 'device';

/**
 * What is saved on the account for each choice. The web counts "paper" and "bright" both as light; "dark" is dark. "Use device
 * settings" saves "paper", the theme every account starts with, which the app reads as "no choice made" and so follows the phone.
 */
export const THEME_OF_MODE = {
  light: 'bright',
  dark: 'dark',
  device: 'paper',
} as const satisfies Record<Mode, SessionResponse['user']['theme']>;

/** What React Native is told to follow the phone's own setting: this version has no `null` for it. */
export const FOLLOW_PHONE = 'unspecified';

/**
 * The colour scheme to force for an account theme, or `FOLLOW_PHONE`. "paper" is what every account starts with, so it
 * is "no choice made yet": the app keeps following the phone's light/dark setting until the person picks one.
 */
export function schemeOf(
  theme: SessionResponse['user']['theme'] | undefined,
): Scheme | typeof FOLLOW_PHONE {
  if (theme === 'dark') return 'dark';
  if (theme === 'bright') return 'light';
  return FOLLOW_PHONE;
}

/** The row the Appearance screen ticks for an account theme: "Use device settings" for "paper" and while the session loads. */
export function modeOf(theme: SessionResponse['user']['theme'] | undefined): Mode {
  if (theme === 'dark') return 'dark';
  if (theme === 'bright') return 'light';
  return 'device';
}
