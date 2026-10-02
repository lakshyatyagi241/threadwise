import { Fraunces, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';

/**
 * The type of the guest pages (sign-in, sign-up, recovery, onboarding): a display serif whose italic carries the
 * accent word of every heading, a rounded sans for text and a mono for eyebrows and codes. All three are open-licence
 * (SIL OFL) families served through `next/font`, which self-hosts the files with the build. They load for the guest
 * route groups only; the signed-in app keeps its own type.
 */
const serif = Fraunces({
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  display: 'swap',
  variable: '--font-auth-serif',
});

const sans = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-auth-sans',
});

const mono = JetBrains_Mono({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-auth-mono',
});

/** Class names that define the three `--font-auth-*` variables; put them on the guest layout's wrapper. */
export const authFontVariables = `${serif.variable} ${sans.variable} ${mono.variable}`;
