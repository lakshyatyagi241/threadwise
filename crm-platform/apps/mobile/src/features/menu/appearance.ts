import type { SessionResponse } from '@crm/contracts';

/** The two choices the Appearance screen offers. */
export type Mode = 'light' | 'dark';

/** What is saved on the account for each choice. The web counts "paper" and "bright" both as light; "dark" is dark. */
export const THEME_OF_MODE = { light: 'bright', dark: 'dark' } as const satisfies Record<
  Mode,
  SessionResponse['user']['theme']
>;

/** What React Native is told to follow the phone's own setting: this version has no `null` for it. */
export const FOLLOW_PHONE = 'unspecified';

/**
 * The colour scheme to force for an account theme, or `FOLLOW_PHONE`. "paper" is what every account starts with, so it
 * is "no choice made yet": the app keeps following the phone's light/dark setting until the person picks one.
 */
export function schemeOf(
  theme: SessionResponse['user']['theme'] | undefined,
): Mode | typeof FOLLOW_PHONE {
  if (theme === 'dark') return 'dark';
  if (theme === 'bright') return 'light';
  return FOLLOW_PHONE;
}
