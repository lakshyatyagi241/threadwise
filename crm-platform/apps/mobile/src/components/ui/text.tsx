import { Text as RNText, type TextProps } from 'react-native';
import { typography, type ThemeColors, type TypographyVariant } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props extends TextProps {
  variant?: TypographyVariant;
  muted?: boolean;
  danger?: boolean;
  /** A theme colour by name, for text on a coloured surface (the brand band, a banner). Wins over `muted` and `danger`. */
  color?: keyof ThemeColors;
}

/** Every piece of text in the app. Honours the phone's font-size setting (no `allowFontScaling={false}`). */
export function Text({ variant = 'body', muted, danger, color, style, ...rest }: Props) {
  const { colors } = useTheme();
  const resolved = color
    ? colors[color]
    : danger
      ? colors.danger
      : muted
        ? colors.textMuted
        : colors.text;
  return <RNText {...rest} style={[typography[variant], { color: resolved }, style]} />;
}
