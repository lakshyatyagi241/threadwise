import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Button } from '@/components/ui/button';
import { PickerField, PickerOption } from '@/components/ui/picker-row';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { SEARCH_DEBOUNCE_MS, useDebounced } from '@/lib/hooks/use-debounced';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import type { ContactChoice } from './deal-validation';
import { useContactChoices } from './use-deals';

interface Props {
  value: ContactChoice | null;
  onChange: (value: ContactChoice | null) => void;
  error?: string | null;
}

/** The deal's customer: shows the chosen contact (or "No customer") and opens a searchable list to change it. */
export function ContactField({ value, onChange, error }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS);
  const choices = useContactChoices(q, open);

  const choose = (next: ContactChoice | null) => {
    onChange(next);
    setOpen(false);
    setText('');
  };
  const close = () => {
    setOpen(false);
    setText('');
  };

  return (
    <>
      <PickerField
        label={t('deals.form.contact')}
        value={value ? value.name || t('deals.unknownContact') : t('deals.form.contactNone')}
        error={error}
        onPress={() => setOpen(true)}
      />
      <Modal transparent visible={open} animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView
          behavior="padding"
          style={[styles.scrim, { backgroundColor: colors.scrim }]}
        >
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text variant="heading" accessibilityRole="header">
              {t('deals.form.contactPick')}
            </Text>
            <TextField
              label={t('deals.form.contactSearchLabel')}
              placeholder={t('deals.form.contactSearchPlaceholder')}
              value={text}
              onChangeText={setText}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            <ScrollView
              contentContainerStyle={styles.list}
              accessibilityRole="radiogroup"
              keyboardShouldPersistTaps="handled"
            >
              <PickerOption
                label={t('deals.form.contactNone')}
                selected={value === null}
                onPress={() => choose(null)}
              />
              {choices.data?.map((contact) => {
                const name = contact.name?.trim() || contact.phone || contact.email || '';
                return (
                  <PickerOption
                    key={contact.id}
                    label={name || t('deals.unknownContact')}
                    caption={
                      [contact.email, contact.phone].find((line) => line && line !== name) ?? null
                    }
                    selected={value?.id === contact.id}
                    onPress={() => choose({ id: contact.id, name })}
                  />
                );
              })}
              {choices.isPending ? (
                <View accessible accessibilityLabel={t('common.loading')}>
                  <ActivityIndicator />
                </View>
              ) : null}
              {choices.data && choices.data.length === 0 ? (
                <Text muted style={styles.empty}>
                  {t('deals.form.contactEmpty')}
                </Text>
              ) : null}
              {choices.isError ? (
                <View style={styles.failed}>
                  <Text danger accessibilityRole="alert">
                    {t('deals.form.contactFailed')}
                  </Text>
                  <Button
                    variant="secondary"
                    label={t('common.retry')}
                    onPress={() => void choices.refetch()}
                  />
                </View>
              ) : null}
            </ScrollView>
            <Button variant="link" label={t('deals.cancel')} onPress={close} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
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
    gap: spacing.md,
  },
  list: { gap: spacing.xs },
  empty: { paddingVertical: spacing.md },
  failed: { gap: spacing.sm, paddingVertical: spacing.sm },
});
