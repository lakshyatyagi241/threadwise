import { useColorScheme } from 'react-native';
import { palette, radius, spacing, type ThemeColors } from './tokens';

export interface Theme {
  scheme: 'light' | 'dark';
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
}

/** Follows the phone's light/dark setting. */
export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: palette[scheme], spacing, radius };
}
