import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import type { ContactFilters } from './api';
import { LIFECYCLE_STAGES, NO_FILTERS, cleanFilters } from './filters';

interface Props {
  filters: ContactFilters;
  onApply: (filters: ContactFilters) => void;
  onClose: () => void;
}

/** The marketing choice as a word, since the API takes a yes/no/unset flag. */
type Marketing = 'all' | 'subscribed' | 'unsubscribed';
const toMarketing = (v: boolean | undefined): Marketing =>
  v === undefined ? 'all' : v ? 'unsubscribed' : 'subscribed';
const fromMarketing = (m: Marketing): boolean | undefined =>
  m === 'all' ? undefined : m === 'unsubscribed';

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primarySoft : colors.surface,
          borderColor: selected ? colors.primary : colors.borderStrong,
        },
      ]}
    >
      <Text variant="label" color={selected ? 'primary' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The filters the list offers, in a sheet. The screen mounts it fresh each time it opens, so it starts from what is applied.
 * Nothing changes on the list until "Apply"; "Clear all" empties the sheet and applies. */
export function FilterModal({ filters, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [draft, setDraft] = useState<ContactFilters>(filters);

  const marketing = toMarketing(draft.unsubscribed);
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.scrim, { backgroundColor: colors.scrim }]}>
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="heading" accessibilityRole="header">
            {t('contacts.filter.title')}
          </Text>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.group} accessibilityRole="radiogroup">
              <Text variant="label" muted>
                {t('contacts.filter.stage')}
              </Text>
              <View style={styles.chips}>
                <Chip
                  label={t('contacts.filter.any')}
                  selected={draft.lifecycleStage === undefined}
                  onPress={() => setDraft({ ...draft, lifecycleStage: undefined })}
                />
                {LIFECYCLE_STAGES.map((stage) => (
                  <Chip
                    key={stage}
                    label={t(`contacts.stage.${stage}`)}
                    selected={draft.lifecycleStage === stage}
                    onPress={() => setDraft({ ...draft, lifecycleStage: stage })}
                  />
                ))}
              </View>
            </View>
            <View style={styles.group} accessibilityRole="radiogroup">
              <Text variant="label" muted>
                {t('contacts.filter.marketing')}
              </Text>
              <View style={styles.chips}>
                {(['all', 'subscribed', 'unsubscribed'] as const).map((value) => (
                  <Chip
                    key={value}
                    label={t(`contacts.filter.marketingOptions.${value}`)}
                    selected={marketing === value}
                    onPress={() => setDraft({ ...draft, unsubscribed: fromMarketing(value) })}
                  />
                ))}
              </View>
            </View>
            <TextField
              label={t('contacts.filter.source')}
              hint={t('contacts.filter.sourceHint')}
              value={draft.source ?? ''}
              onChangeText={(source) => setDraft({ ...draft, source })}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
            />
          </ScrollView>
          <View style={styles.actions}>
            <Button
              variant="secondary"
              label={t('contacts.filter.clear')}
              onPress={() => {
                setDraft(NO_FILTERS);
                onApply(NO_FILTERS);
              }}
            />
            <Button
              label={t('contacts.filter.apply')}
              onPress={() => onApply(cleanFilters({ ...draft, q: filters.q }))}
            />
            <Button variant="link" label={t('contacts.cancel')} onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  body: { gap: spacing.xl },
  group: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  actions: { gap: spacing.sm },
});
