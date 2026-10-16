import type { DealStageRef } from '@crm/contracts';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { HeaderIconButton } from '@/components/ui/screen-header';
import { SelectField } from '@/components/ui/select-field';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField, type TextFieldHandle } from '@/components/ui/text-field';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ContactField } from './contact-field';
import { currencyChoices } from './money';
import { OwnerField } from './owner-field';
import { validateDeal, type DealFormField, type DealFormValues } from './deal-validation';

interface Props {
  /** `create` or `edit`: the header title differs, and only a new deal picks its first stage here. */
  mode: 'create' | 'edit';
  initial: DealFormValues;
  /** The pipeline's stages, for a new deal's starting stage; empty hides the field (the API then uses the first). */
  stages: readonly DealStageRef[];
  /** The pipeline's own currency, always offered. */
  pipelineCurrency: string;
  canListTeam: boolean;
  myId: string | undefined;
  pending: boolean;
  /** A message about the whole form (a failed save), shown above the fields. */
  banner?: string | null;
  /** Something for the person to look at before saving again (someone else changed the deal). */
  notice?: string | null;
  /** What the server refused, by field, in the person's language. */
  serverErrors?: Partial<Record<DealFormField, string>>;
  onBack: () => void;
  /** Called with checked values. */
  onSubmit: (values: DealFormValues) => void;
}

/**
 * The form to add a deal and to edit one, under its own header whose check button saves. Fields in order: name, value, currency,
 * the starting stage (a new deal only), owner, customer and the expected close day (typed, since the app has no native date picker).
 * The client checks what the API's schema checks; everything else is the server's answer, shown under the field or above the form.
 */
export function DealEditor({
  mode,
  initial,
  stages,
  pipelineCurrency,
  canListTeam,
  myId,
  pending,
  banner,
  notice,
  serverErrors,
  onBack,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [values, setValues] = useState(initial);
  const [checked, setChecked] = useState<Partial<Record<DealFormField, string>>>({});
  const valueInput = useRef<TextFieldHandle>(null);

  const change = <K extends keyof DealFormValues>(field: K, value: DealFormValues[K]) => {
    setValues({ ...values, [field]: value });
    setChecked({ ...checked, [field === 'currency' ? 'value' : field]: undefined });
  };

  const submit = () => {
    if (pending) return;
    const problems = validateDeal(values);
    const messages: Partial<Record<DealFormField, string>> = {};
    for (const [field, key] of Object.entries(problems) as [
      DealFormField,
      NonNullable<(typeof problems)[DealFormField]>,
    ][]) {
      messages[field] = t(key);
    }
    setChecked(messages);
    if (Object.keys(messages).length === 0) onSubmit(values);
  };

  const error = (field: DealFormField) => checked[field] ?? serverErrors?.[field];

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={mode === 'edit' ? t('deals.form.editTitle') : t('deals.form.addTitle')}
        onBack={onBack}
        actions={
          pending ? (
            <View style={styles.saving}>
              <ActivityIndicator accessibilityLabel={t('deals.form.saving')} />
            </View>
          ) : (
            <HeaderIconButton icon="checkmark" label={t('deals.form.save')} onPress={submit} />
          )
        }
      />
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {notice ? <Banner tone="warning" message={notice} /> : null}
          {banner ? <Banner tone="danger" message={banner} /> : null}
          <TextField
            label={t('deals.form.title')}
            placeholder={t('deals.form.titlePlaceholder')}
            value={values.title}
            onChangeText={(v) => change('title', v)}
            error={error('title')}
            autoCapitalize="sentences"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => valueInput.current?.focus()}
          />
          <TextField
            label={t('deals.form.value')}
            value={values.value}
            onChangeText={(v) => change('value', v)}
            error={error('value')}
            inputRef={valueInput}
            keyboardType="decimal-pad"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.group}>
            <Text variant="label">{t('deals.form.currency')}</Text>
            <SelectField
              label={t('deals.form.currency')}
              placeholder={t('deals.form.currency')}
              options={currencyChoices(pipelineCurrency).map((code) => ({
                value: code,
                label: code,
              }))}
              value={values.currency}
              onChange={(v) => change('currency', v)}
            />
          </View>
          {mode === 'create' && stages.length > 0 ? (
            <View style={styles.group}>
              <Text variant="label">{t('deals.form.stage')}</Text>
              <SelectField
                label={t('deals.form.stage')}
                placeholder={t('deals.form.stage')}
                options={stages.map((stage) => ({ value: stage.id, label: stage.name }))}
                value={values.stageId}
                onChange={(v) => change('stageId', v)}
              />
            </View>
          ) : null}
          <OwnerField
            value={values.owner}
            onChange={(v) => change('owner', v)}
            canListTeam={canListTeam}
            myId={myId}
          />
          {canListTeam ? (
            <ContactField value={values.contact} onChange={(v) => change('contact', v)} />
          ) : null}
          <TextField
            label={t('deals.form.expectedClose')}
            hint={t('deals.form.expectedCloseHint')}
            value={values.close}
            onChangeText={(v) => change('close', v)}
            error={error('close')}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  group: { gap: spacing.xs },
  saving: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
