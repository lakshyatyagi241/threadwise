import { Geist, Geist_Mono, Inter } from 'next/font/google';

/**
 * The app's base type: Geist for text, Geist Mono for code and monospace copy. Both are open-licence
 * (SIL OFL) families served through `next/font`, which self-hosts the files with the build. Loaded
 * once in the root layout so every domain's `font-sans`/`font-mono` utility resolves to them.
 */
const sans = Geist({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-geist-sans',
});

const mono = Geist_Mono({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-geist-mono',
});

/** Inter, for the operator dashboard's heading block (`--font-inter`), upright and italic, weight 600. */
const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  weight: ['600'],
  style: ['normal', 'italic'],
  variable: '--font-inter',
});

/** Class names that define `--font-geist-sans`/`--font-geist-mono`/`--font-inter`; put them on the root `<body>`. */
export const appFontVariables = `${sans.variable} ${mono.variable} ${inter.variable}`;
