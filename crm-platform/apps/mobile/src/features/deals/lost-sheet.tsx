import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { PickerOption } from '@/components/ui/picker-row';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import {
  LOST_REASON_KEYS,
  LOST_REASON_MAX,
  OTHER,
  lostReasonToSend,
  resolveLostReason,
  type LostReasonPayload,
  type ReasonOption,
} from './lost-reasons';
import { useDealSettings, useLostReasons } from './use-deals';

interface Props {
  dealTitle: string;
  /** The person may read pipelines: the catalogue and the "reason required" setting live there. Without it, presets and free text. */
  canReadSettings: boolean;
  pending: boolean;
  /** Why the last try failed, in the person's language; the sheet stays open to try again. */
  error?: string | null;
  onConfirm: (reason: LostReasonPayload) => void;
  onClose: () => void;
}

/**
 * Closing a deal as lost offers a reason, and insists on one only when the workspace setting "require a reason" is on; with it off,
 * "Mark as lost" works with no reason. The choices are the workspace's lost-reason catalogue; until it has entries the sheet offers a
 * few presets. "Other" asks for a few words. The screen mounts it only while it is needed, so it starts empty each time.
 */
export function LostSheet({
  dealTitle,
  canReadSettings,
  pending,
  error,
  onConfirm,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const catalogue = useLostReasons(canReadSettings);
  const settings = useDealSettings(canReadSettings);
  // A failed settings call counts as required: the server is the authority and refuses a missing reason either way.
  const required =
    canReadSettings && (settings.isError || (settings.data?.lostReasonRequired ?? false));
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');
  const [touched, setTouched] = useState(false);

  const options = useMemo<ReasonOption[]>(() => {
    const rows = catalogue.data ?? [];
    if (rows.length > 0) return rows.map((r) => ({ value: `r:${r.id}`, label: r.name, id: r.id }));
    return LOST_REASON_KEYS.map((key) => ({
      value: `p:${key}`,
      label: t(`deals.lost.presets.${key}`),
    }));
  }, [catalogue.data, t]);
  const complete = resolveLostReason(choice, options, other);
  const effective = lostReasonToSend(choice, options, other, required);
  const loading = canReadSettings && (catalogue.isPending || settings.isPending);

  const submit = () => {
    setTouched(true);
    if (effective && !pending) onConfirm(effective);
  };

  return (
    <Modal transparent visible animationType="slide" onRequestClose={() => !pending && onClose()}>
      <KeyboardAvoidingView
        behavior="padding"
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
      >
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="heading" accessibilityRole="header">
            {t('deals.lost.title')}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {dealTitle}
          </Text>
          <Text muted>{required ? t('deals.lost.introRequired') : t('deals.lost.intro')}</Text>
          {error ? <Banner tone="danger" message={error} /> : null}
          <ScrollView
            contentContainerStyle={styles.list}
            accessibilityRole="radiogroup"
            keyboardShouldPersistTaps="handled"
          >
            {options.map((o) => (
              <PickerOption
                key={o.value}
                label={o.label}
                selected={choice === o.value}
                onPress={() => setChoice(choice === o.value ? '' : o.value)}
              />
            ))}
            <PickerOption
              label={t('deals.lost.other')}
              selected={choice === OTHER}
              onPress={() => setChoice(choice === OTHER ? '' : OTHER)}
            />
            {loading ? (
              <View accessible accessibilityLabel={t('common.loading')}>
                <ActivityIndicator />
              </View>
            ) : null}
            {choice === OTHER ? (
              <TextField
                label={t('deals.lost.details')}
                value={other}
                onChangeText={setOther}
                maxLength={LOST_REASON_MAX}
                autoFocus
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                error={touched && !complete ? t('deals.lost.needed') : null}
              />
            ) : null}
            {touched && !choice && required ? (
              <Text variant="caption" danger accessibilityRole="alert">
                {t('deals.lost.needed')}
              </Text>
            ) : null}
          </ScrollView>
          <Button
            label={t('deals.lost.confirm')}
            loading={pending}
            disabled={pending || loading}
            onPress={submit}
          />
          <Button variant="link" label={t('deals.cancel')} disabled={pending} onPress={onClose} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  list: { gap: spacing.xs },
});
