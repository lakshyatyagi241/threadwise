import { Fraunces, Geist, Geist_Mono } from 'next/font/google';

/**
 * The type of the guest pages (sign-in, sign-up, recovery, onboarding): a display serif whose italic carries the
 * accent word of every heading in designs 1-5, Geist for text (the same base family as the rest of the app) and
 * Geist Mono for eyebrows and codes. All are open-licence (SIL OFL) families served through `next/font`, which
 * self-hosts the files with the build. They load for the guest route groups only.
 */
const serif = Fraunces({
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  display: 'swap',
  variable: '--font-auth-serif',
});

const sans = Geist({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-auth-sans',
});

const mono = Geist_Mono({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-auth-mono',
});

/** Class names that define the three `--font-auth-*` variables; put them on the guest layout's wrapper. */
export const authFontVariables = `${serif.variable} ${sans.variable} ${mono.variable}`;
