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
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { PickerField, PickerOption } from '@/components/ui/picker-row';
import type { ContactChoice } from './task-validation';
import { SEARCH_DEBOUNCE_MS, useDebounced } from '@/lib/hooks/use-debounced';
import { useContactChoices } from './use-tasks';

interface Props {
  value: ContactChoice | null;
  onChange: (value: ContactChoice | null) => void;
  error?: string | null;
}

/** The optional link to a contact: shows the chosen one (or "No contact") and opens a searchable list to change it. */
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
        label={t('tasks.form.contactLinkOptional')}
        value={value ? value.name || t('tasks.unknownContact') : t('tasks.form.contactPlaceholder')}
        placeholder={value === null}
        icon="search"
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
              {t('tasks.form.contactPick')}
            </Text>
            <TextField
              label={t('tasks.form.contactSearchLabel')}
              placeholder={t('tasks.form.contactSearchPlaceholder')}
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
                label={t('tasks.form.contactNone')}
                selected={value === null}
                onPress={() => choose(null)}
              />
              {choices.data?.map((contact) => {
                const name = contact.name?.trim() || contact.phone || contact.email || '';
                return (
                  <PickerOption
                    key={contact.id}
                    label={name || t('tasks.unknownContact')}
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
                  {t('tasks.form.contactEmpty')}
                </Text>
              ) : null}
              {choices.isError ? (
                <View style={styles.failed}>
                  <Text danger accessibilityRole="alert">
                    {t('tasks.form.contactFailed')}
                  </Text>
                  <Button
                    variant="secondary"
                    label={t('common.retry')}
                    onPress={() => void choices.refetch()}
                  />
                </View>
              ) : null}
            </ScrollView>
            <Button variant="link" label={t('tasks.cancel')} onPress={close} />
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
