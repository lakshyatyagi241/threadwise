import { Children, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text as RNText, type TextProps } from 'react-native';
import { usesShapedScript } from '@/lib/i18n/locales';
import { withInter } from '@/lib/theme/fonts';
import { typography, type ThemeColors, type TypographyVariant } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props extends TextProps {
  variant?: TypographyVariant;
  muted?: boolean;
  danger?: boolean;
  /** A theme colour by name, for text on a coloured surface (the brand band, a banner). Wins over `muted` and `danger`. */
  color?: keyof ThemeColors;
  /**
   * Forces the trailing-space fix below even for a non-shaped (e.g. English) locale. For a label whose box is sized tight to its
   * content and can turn bold (the bottom tab bar is exactly this), the same Android measure-vs-draw mismatch that motivated the
   * fix for Devanagari can clip the last letter of ordinary Latin text too, depending on the phone's system font.
   */
  preventClip?: boolean;
}

/**
 * A non-breaking space. On Android the width a line of Devanagari is measured at can come out a hair narrower than the width it is
 * drawn at, so a label that is only as wide as its text wraps its last word onto a line that is not there and loses it. One
 * invisible space at the end gives the line the room it needs. Built from its code so that no invisible character sits in the source.
 */
const SLACK = String.fromCharCode(0xa0);

/** The text with room at the end, when it is plain text (a string, a number, or a run of them); anything else is left alone. */
function withSlack(children: ReactNode): ReactNode {
  const parts = Children.toArray(children);
  if (parts.length === 0 || !parts.every((p) => typeof p === 'string' || typeof p === 'number')) {
    return children;
  }
  return parts.join('') + SLACK;
}

/** Small capitals above a group of things (a kicker): upper case and spaced out, which only suits letters that have a case. */
const LATIN_OVERLINE = { textTransform: 'uppercase', letterSpacing: 1.2 } as const;

/**
 * Every piece of text in the app. Honours the phone's font-size setting (no `allowFontScaling={false}`). Drawn in Inter, as in the
 * Geta app, with the file chosen from the style's `fontWeight` (see `lib/theme/fonts`). Hindi and Marathi keep the phone's own
 * font and its weights: Inter has no Devanagari, so those letters come from the system either way, and a weight carried only by an
 * Inter file would not reach them.
 */
export function Text({
  variant = 'body',
  muted,
  danger,
  color,
  preventClip,
  style,
  children,
  ...rest
}: Props) {
  const { colors } = useTheme();
  const { i18n } = useTranslation();
  const devanagari = usesShapedScript(i18n.language);
  const shaped = devanagari || preventClip === true;
  const resolved = color
    ? colors[color]
    : danger
      ? colors.danger
      : muted
        ? colors.textMuted
        : colors.text;
  const flat = StyleSheet.flatten([
    typography[variant],
    { color: resolved },
    variant === 'overline' && !shaped ? LATIN_OVERLINE : null,
    style,
  ]);
  return (
    <RNText {...rest} style={devanagari ? flat : withInter(flat)}>
      {shaped ? withSlack(children) : children}
    </RNText>
  );
}
