import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcon, type MaterialIconName } from '@/components/ui/icon';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import type { ActiveFormats, Mark } from './format-text';

type FormatId = 'bold' | 'italic' | 'underline' | 'strike' | 'bullets' | 'numbers';

const BUTTONS: readonly { id: FormatId; icon: MaterialIconName; gapAfter?: boolean }[] = [
  { id: 'bold', icon: 'format-bold' },
  { id: 'italic', icon: 'format-italic' },
  { id: 'underline', icon: 'format-underlined' },
  { id: 'strike', icon: 'format-strikethrough', gapAfter: true },
  { id: 'bullets', icon: 'format-list-bulleted' },
  { id: 'numbers', icon: 'format-list-numbered' },
];

interface Props {
  /** Which buttons show as pressed at the caret or the selection. */
  active: ActiveFormats;
  onMark: (mark: Mark) => void;
  onUnderline: () => void;
  onList: (kind: 'bullet' | 'number') => void;
}

/**
 * The formatting buttons under the message box, as on the web inbox: bold, italic, underline, strikethrough, bullets and numbers.
 * They write WhatsApp's marks (`*bold*`, `_italic_`, `~strike~`, `- ` and `1. ` lines) into the text, so the customer sees the
 * formatting in WhatsApp; the box itself keeps showing the marks.
 */
export function FormatBar({ active, onMark, onUnderline, onList }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const press: Record<FormatId, () => void> = {
    bold: () => onMark('*'),
    italic: () => onMark('_'),
    underline: onUnderline,
    strike: () => onMark('~'),
    bullets: () => onList('bullet'),
    numbers: () => onList('number'),
  };
  return (
    <View
      accessibilityRole="toolbar"
      accessibilityLabel={t('inbox.composer.format.label')}
      style={styles.row}
    >
      {BUTTONS.map(({ id, icon, gapAfter }) => {
        const on = active[id];
        return (
          <View key={id} style={[styles.cell, gapAfter && styles.gap]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(`inbox.composer.format.${id}`)}
              accessibilityState={{ selected: on }}
              onPress={press[id]}
              style={[styles.button, on && { backgroundColor: colors.primarySoft }]}
            >
              <MaterialIcon name={icon} size={24} color={on ? 'primary' : 'textMuted'} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  cell: { alignItems: 'center' },
  gap: { marginEnd: spacing.md },
  button: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
});
