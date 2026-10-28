import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

export type ComposerMode = 'reply' | 'note';

const MODES: readonly ComposerMode[] = ['reply', 'note'];

interface Props {
  mode: ComposerMode;
  onChange: (mode: ComposerMode) => void;
}

/**
 * "Reply | Internal note" above the message box, as on the web inbox. A reply goes to the customer; an internal note stays inside the
 * team and, unlike a reply, can still be written when the 24-hour window is closed. The note tab is tinted warm, like the note box.
 */
export function ModeTabs({ mode, onChange }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={t('inbox.composer.mode.label')}
      style={[styles.row, { backgroundColor: colors.surface, borderTopColor: colors.border }]}
    >
      {MODES.map((m) => {
        const selected = mode === m;
        const tint = m === 'note' ? colors.warning : colors.primary;
        const soft = m === 'note' ? colors.warningSoft : colors.primarySoft;
        return (
          <Pressable
            key={m}
            accessibilityRole="tab"
            accessibilityLabel={t(`inbox.composer.mode.${m}`)}
            accessibilityState={{ selected }}
            onPress={() => onChange(m)}
            style={[styles.tab, selected && { backgroundColor: soft }]}
          >
            <Text variant="label" style={{ color: selected ? tint : colors.textMuted }}>
              {t(`inbox.composer.mode.${m}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
});
