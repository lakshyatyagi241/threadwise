import { StyleSheet, View } from 'react-native';
import type { ThemeColors } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Text } from './text';

/** Soft background and strong letter colour pairs. A person keeps the same pair, picked from their name. */
const TONES: readonly { background: keyof ThemeColors; text: keyof ThemeColors }[] = [
  { background: 'primarySoft', text: 'primary' },
  { background: 'successSoft', text: 'success' },
  { background: 'warningSoft', text: 'warning' },
  { background: 'instagramSoft', text: 'instagram' },
  { background: 'dangerSoft', text: 'danger' },
];

/** Up to two capital letters from a name; a phone number or an empty name gives a single fallback mark. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('');
  return letters ? letters.toUpperCase() : '?';
}

function toneIndex(seed: string): number {
  let sum = 0;
  for (const ch of seed) sum = (sum + ch.charCodeAt(0)) % TONES.length;
  return sum;
}

interface Props {
  name: string | null | undefined;
  /** What tone is picked from; the name when absent. */
  seed?: string;
  size?: number;
}

/** A round mark with a person's initials. Decorative: the row beside it already says the name. */
export function Avatar({ name, seed, size = 40 }: Props) {
  const { colors } = useTheme();
  const tone = TONES[toneIndex(seed ?? name ?? '')] ?? TONES[0]!;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors[tone.background],
        },
      ]}
    >
      <Text variant="label" color={tone.text}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
});
