import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark } from '@/components/ui/brand-mark';
import { Icon } from '@/components/ui/icon';
import { HeaderIconButton } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { BRAND_NAME } from '@/config/brand';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { CATEGORY_TITLE } from './help-categories';
import { docsIn, HELP_CATEGORIES, textOf, type HelpCategory } from './help-data';

interface Props {
  visible: boolean;
  onClose: () => void;
  onOpenDoc: (id: string) => void;
}

/**
 * The guide menu (the Geta Help screen's side menu): the product at the top, then every group with a button that opens its guides
 * underneath, one group at a time. Pressing a guide opens it and closes the menu; pressing the dimmed side closes it.
 */
export function HelpDrawer({ visible, onClose, onOpenDoc }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<HelpCategory | null>(null);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <View
          accessibilityViewIsModal
          style={[
            styles.panel,
            { backgroundColor: colors.surface, paddingTop: insets.top + spacing.md },
          ]}
        >
          <View style={styles.head}>
            <View style={styles.brand}>
              <BrandMark size={44} />
              <Text variant="heading">{BRAND_NAME}</Text>
            </View>
            <HeaderIconButton icon="close" label={t('help.menuClose')} onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            {HELP_CATEGORIES.map((category) => {
              const expanded = open === category;
              return (
                <View key={category}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(CATEGORY_TITLE[category])}
                    accessibilityState={{ expanded }}
                    onPress={() => setOpen(expanded ? null : category)}
                    style={styles.category}
                  >
                    <Text variant="subheading" style={styles.categoryName}>
                      {t(CATEGORY_TITLE[category])}
                    </Text>
                    <View style={[styles.chevron, { backgroundColor: colors.surfaceMuted }]}>
                      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} />
                    </View>
                  </Pressable>
                  {expanded
                    ? docsIn(category).map((doc) => {
                        const title = textOf(doc, i18n.language).text.title;
                        return (
                          <Pressable
                            key={doc.id}
                            accessibilityRole="button"
                            accessibilityLabel={title}
                            onPress={() => {
                              onClose();
                              onOpenDoc(doc.id);
                            }}
                            style={styles.doc}
                          >
                            <Text muted>{title}</Text>
                          </Pressable>
                        );
                      })
                    : null}
                </View>
              );
            })}
          </ScrollView>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('help.menuClose')}
          onPress={onClose}
          style={[styles.scrim, { backgroundColor: colors.scrim }]}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  panel: { width: '78%', maxWidth: 360, paddingHorizontal: spacing.xl },
  scrim: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  list: { paddingVertical: spacing.lg },
  category: {
    minHeight: MIN_TOUCH_TARGET + spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  categoryName: { flex: 1 },
  chevron: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doc: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingEnd: spacing.md },
});
