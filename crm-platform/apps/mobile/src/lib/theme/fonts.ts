import { useFonts } from 'expo-font';
import type { TextStyle } from 'react-native';
import bold from '@/assets/fonts/Inter-Bold.ttf';
import medium from '@/assets/fonts/Inter-Medium.ttf';
import regular from '@/assets/fonts/Inter-Regular.ttf';
import semibold from '@/assets/fonts/Inter-SemiBold.ttf';

/**
 * Inter, the typeface of the Geta mobile app (SIL Open Font License), as four static files. A custom font on a phone has no weight
 * axis to pick from: React Native chooses a file by its family name, so each weight is its own family and `fontWeight` is dropped
 * from the style once the family is chosen (`withInter`). Left in, Android and iOS would draw a second, synthetic bold on top.
 */
export const FONT_FAMILY = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

const FONT_FILES = {
  [FONT_FAMILY.regular]: regular,
  [FONT_FAMILY.medium]: medium,
  [FONT_FAMILY.semibold]: semibold,
  [FONT_FAMILY.bold]: bold,
};

const NAMED_WEIGHT: Record<string, number> = {
  ultralight: 100,
  thin: 200,
  light: 300,
  normal: 400,
  regular: 400,
  condensed: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  condensedBold: 700,
  heavy: 800,
  black: 900,
};

function numericWeight(weight: TextStyle['fontWeight']): number {
  if (weight === undefined) return 400;
  const n = typeof weight === 'number' ? weight : (NAMED_WEIGHT[weight] ?? Number(weight));
  return Number.isFinite(n) ? n : 400;
}

/** The Inter family that draws a CSS-style weight: 700 and up is Bold (there is no heavier file), then SemiBold, Medium, Regular. */
export function fontFamilyFor(weight: TextStyle['fontWeight']): string {
  const w = numericWeight(weight);
  if (w >= 700) return FONT_FAMILY.bold;
  if (w >= 600) return FONT_FAMILY.semibold;
  if (w >= 500) return FONT_FAMILY.medium;
  return FONT_FAMILY.regular;
}

/** The style with Inter chosen for its weight. A `fontFamily` the caller set on purpose is kept. */
export function withInter(style: TextStyle): TextStyle {
  const { fontWeight, fontFamily, ...rest } = style;
  return { ...rest, fontFamily: fontFamily ?? fontFamilyFor(fontWeight) };
}

/** Loads the four files. `[loaded, error]` as in expo-font: the first screen waits for one of the two (see the root layout). */
export const useAppFonts = () => useFonts(FONT_FILES);
