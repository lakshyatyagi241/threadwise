import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { useContactViews } from './use-contacts';
import { SYSTEM_VIEW_IDS, type ChosenView } from './views';

interface Props {
  chosen: ChosenView;
  /** Whether the person may read saved views; without it only the built-in ones are offered. */
  canReadSaved: boolean;
  onChoose: (view: ChosenView) => void;
  onClose: () => void;
}

/**
 * The list of views, sliding in from the right: a search box, "System default views" (the built-in ones) and "Custom views" (the
 * workspace's saved ones). Choosing one closes the drawer and the list shows that view.
 */
export function ViewsDrawer({ chosen, canReadSaved, onChoose, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [search, setSearch] = useState('');
  const saved = useContactViews(canReadSaved);
  const needle = search.trim().toLowerCase();

  const system = useMemo(
    () =>
      SYSTEM_VIEW_IDS.map((id) => ({ id, name: t(`contacts.views.system.${id}`) })).filter((v) =>
        v.name.toLowerCase().includes(needle),
      ),
    [t, needle],
  );
  const custom = useMemo(
    () => (saved.data?.data ?? []).filter((v) => v.name.toLowerCase().includes(needle)),
    [saved.data, needle],
  );
  const nothing = system.length === 0 && custom.length === 0 && !saved.isPending;

  const row = (key: string, name: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.row}
    >
      <Text variant={selected ? 'label' : 'body'} numberOfLines={1} style={styles.rowText}>
        {name}
      </Text>
      {selected ? <Icon name="checkmark" size={20} color="primary" /> : null}
    </Pressable>
  );

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('contacts.views.close')}
          style={[styles.scrim, { backgroundColor: colors.scrim }]}
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
          style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.head}>
            <Text variant="heading" accessibilityRole="header" style={styles.rowText}>
              {t('contacts.views.title')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('contacts.views.close')}
              onPress={onClose}
              style={styles.close}
            >
              <Icon name="close" size={22} />
            </Pressable>
          </View>
          <TextField
            label={t('contacts.views.searchLabel')}
            placeholder={t('contacts.views.searchPlaceholder')}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
            {system.length > 0 ? (
              <>
                <Text variant="overline" muted>
                  {t('contacts.views.systemTitle')}
                </Text>
                {system.map((v) =>
                  row(
                    `system-${v.id}`,
                    v.name,
                    chosen.kind === 'system' && chosen.id === v.id,
                    () => onChoose({ kind: 'system', id: v.id }),
                  ),
                )}
              </>
            ) : null}
            {canReadSaved ? (
              <>
                <Text variant="overline" muted style={styles.section}>
                  {t('contacts.views.customTitle')}
                </Text>
                {saved.isPending ? (
                  <ActivityIndicator accessibilityLabel={t('common.loading')} />
                ) : saved.isError ? (
                  <View style={styles.retry}>
                    <Text danger accessibilityRole="alert">
                      {t('contacts.views.failed')}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('common.retry')}
                      onPress={() => void saved.refetch()}
                    >
                      <Text color="primary" variant="label">
                        {t('common.retry')}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  custom.map((v) =>
                    row(
                      `custom-${v.id}`,
                      v.name,
                      chosen.kind === 'custom' && chosen.id === v.id,
                      () => onChoose({ kind: 'custom', id: v.id, name: v.name, filter: v.filter }),
                    ),
                  )
                )}
              </>
            ) : null}
            {nothing ? <Text muted>{t('contacts.views.none')}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  scrim: { flex: 1 },
  panel: {
    width: '82%',
    gap: spacing.md,
    padding: spacing.lg,
    paddingTop: spacing.xxl,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center' },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { gap: spacing.xs, paddingBottom: spacing.xxl },
  section: { marginTop: spacing.lg },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowText: { flex: 1 },
  retry: { gap: spacing.sm },
});
