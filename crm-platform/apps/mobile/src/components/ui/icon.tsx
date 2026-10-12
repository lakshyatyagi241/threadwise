import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { ThemeColors } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];

interface Props {
  name: IconName;
  size?: number;
  color?: keyof ThemeColors;
}

/** A themed icon. Decorative: the control around it carries the accessible name, so it is hidden from screen readers. */
export function Icon({ name, size = 22, color = 'text' }: Props) {
  const { colors } = useTheme();
  return (
    <Ionicons
      name={name}
      size={size}
      color={colors[color]}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

/** The same, from the Material set, for the few shapes Ionicons does not have (the filter icon). */
export function MaterialIcon({
  name,
  size = 22,
  color = 'text',
}: {
  name: MaterialIconName;
  size?: number;
  color?: keyof ThemeColors;
}) {
  const { colors } = useTheme();
  return (
    <MaterialIcons
      name={name}
      size={size}
      color={colors[color]}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}
