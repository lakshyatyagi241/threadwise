import { Text as RNText, type TextProps } from 'react-native';
import { typography, type TypographyVariant } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props extends TextProps {
  variant?: TypographyVariant;
  muted?: boolean;
  danger?: boolean;
}

/** Every piece of text in the app. Honours the phone's font-size setting (no `allowFontScaling={false}`). */
export function Text({ variant = 'body', muted, danger, style, ...rest }: Props) {
  const { colors } = useTheme();
  const color = danger ? colors.danger : muted ? colors.textMuted : colors.text;
  return <RNText {...rest} style={[typography[variant], { color }, style]} />;
}
