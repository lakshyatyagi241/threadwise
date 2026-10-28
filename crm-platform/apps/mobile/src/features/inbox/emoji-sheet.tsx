import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { EMOJI_GROUPS, pushRecentEmoji, readRecentEmoji } from './emoji';

/** Seven to a row keeps every emoji at least 48 dp wide on a 360 dp phone. */
const COLUMN_WIDTH = '14.28%';

interface Props {
  visible: boolean;
  /** Puts the emoji into the message box at the caret. The sheet stays open: people add several. */
  onPick: (emoji: string) => void;
  onClose: () => void;
}

/**
 * The emoji panel behind the smile button of the message box, the same sets as the web inbox (smileys, gestures, hearts and symbols,
 * objects) with the ones used last on top. Picking one adds it at the caret and keeps the sheet open; the close button or a tap
 * outside closes it.
 */
export function EmojiSheet(props: Props) {
  return (
    <Modal transparent visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      {/* Only mounted while open, so it always starts on the first group with the latest recents. */}
      <SheetBody {...props} />
    </Modal>
  );
}

function SheetBody({ onPick, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [group, setGroup] = useState<string>(EMOJI_GROUPS[0].id);
  const [recent, setRecent] = useState<readonly string[]>(() => readRecentEmoji());
  const active = EMOJI_GROUPS.find((g) => g.id === group) ?? EMOJI_GROUPS[0];

  const pick = (emoji: string) => {
    setRecent(pushRecentEmoji(emoji));
    onPick(emoji);
  };
  const cell = (emoji: string, key: string) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={emoji}
      onPress={() => pick(emoji)}
      style={({ pressed }) => [
        styles.cell,
        pressed && { backgroundColor: colors.surfaceMuted, borderRadius: radius.md },
      ]}
    >
      <Text style={styles.emoji}>{emoji}</Text>
    </Pressable>
  );

  return (
    <View style={styles.fill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('inbox.sheet.close')}
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
      />
      <View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            paddingBottom: insets.bottom + spacing.sm,
          },
        ]}
      >
        <View style={styles.header}>
          <Text variant="heading" accessibilityRole="header" style={styles.title}>
            {t('inbox.composer.emoji.title')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('inbox.sheet.close')}
            onPress={onClose}
            style={styles.close}
          >
            <Icon name="close" size={24} />
          </Pressable>
        </View>
        <View
          accessibilityRole="tablist"
          accessibilityLabel={t('inbox.composer.emoji.groups')}
          style={[styles.tabs, { borderBottomColor: colors.border }]}
        >
          {EMOJI_GROUPS.map((g) => (
            <Pressable
              key={g.id}
              accessibilityRole="tab"
              accessibilityLabel={t(`inbox.composer.emoji.group.${g.id}`)}
              accessibilityState={{ selected: g.id === active.id }}
              onPress={() => setGroup(g.id)}
              style={[
                styles.tab,
                g.id === active.id && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
              ]}
            >
              <Text style={styles.emoji}>{g.icon}</Text>
            </Pressable>
          ))}
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          {recent.length > 0 ? (
            <View>
              <Text variant="caption" muted style={styles.section}>
                {t('inbox.composer.emoji.recent')}
              </Text>
              <View style={styles.grid}>{recent.map((e) => cell(e, `r-${e}`))}</View>
            </View>
          ) : null}
          <Text variant="caption" muted style={styles.section}>
            {t(`inbox.composer.emoji.group.${active.id}`)}
          </Text>
          <View style={styles.grid}>{active.emoji.map((e) => cell(e, `${active.id}-${e}`))}</View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '65%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingStart: spacing.lg },
  title: { flex: 1 },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  body: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  section: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: COLUMN_WIDTH,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 26, lineHeight: 34 },
});
