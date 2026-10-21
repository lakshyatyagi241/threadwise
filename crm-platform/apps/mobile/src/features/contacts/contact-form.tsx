import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, StyleSheet } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { PhoneField } from '@/components/ui/phone-field';
import { TextField, type TextFieldHandle } from '@/components/ui/text-field';
import { DEFAULT_COUNTRY } from '@/lib/phone/countries';
import { spacing } from '@/lib/theme/tokens';
import { validateContact, type ContactField, type ContactFormValues } from './contact-validation';

interface Props {
  initial: ContactFormValues;
  submitLabel: string;
  pending: boolean;
  /** A message about the whole form (a failed save), shown above the fields. */
  banner?: string | null;
  /** What the server refused, by field, in the person's language. */
  serverErrors?: Partial<Record<ContactField, string>>;
  onSubmit: (values: ContactFormValues) => void;
  onCancel?: () => void;
  /** More inputs under the email (the workspace's required properties on a new contact). */
  extra?: ReactNode;
  /** Checks what `extra` holds when Save is pressed; false keeps the form from being sent. Runs even when the fields above are wrong, so every problem shows at once. */
  beforeSubmit?: () => boolean;
}

export const EMPTY_CONTACT: ContactFormValues = { name: '', phone: '', email: '' };

/**
 * The form to create a contact and to edit one: name, phone and email. The client only checks what the API's own schema checks
 * (one of phone or email, each in the shape the API takes); everything else is the server's answer, shown under the field.
 */
export function ContactForm({
  initial,
  submitLabel,
  pending,
  banner,
  serverErrors,
  onSubmit,
  onCancel,
  extra,
  beforeSubmit,
}: Props) {
  const { t, i18n } = useTranslation();
  const [values, setValues] = useState(initial);
  const [checked, setChecked] = useState<Partial<Record<ContactField, string>>>({});
  const phoneInput = useRef<TextFieldHandle>(null);
  const emailInput = useRef<TextFieldHandle>(null);

  const change = (field: ContactField, value: string) => {
    setValues({ ...values, [field]: value });
    setChecked({ ...checked, [field]: undefined });
  };

  const submit = () => {
    const problems = validateContact(values);
    const messages: Partial<Record<ContactField, string>> = {};
    for (const [field, key] of Object.entries(problems) as [
      ContactField,
      NonNullable<(typeof problems)[ContactField]>,
    ][]) {
      messages[field] = t(key);
    }
    setChecked(messages);
    const extraOk = beforeSubmit ? beforeSubmit() : true;
    if (Object.keys(messages).length === 0 && extraOk) onSubmit(values);
  };

  const error = (field: ContactField) => checked[field] ?? serverErrors?.[field];

  return (
    <View style={styles.form}>
      {banner ? <Banner tone="danger" message={banner} /> : null}
      <TextField
        label={t('contacts.form.name')}
        placeholder={t('contacts.form.namePlaceholder')}
        value={values.name}
        onChangeText={(v) => change('name', v)}
        error={error('name')}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => phoneInput.current?.focus()}
      />
      <PhoneField
        label={t('contacts.form.phone')}
        value={values.phone}
        onChangeText={(v) => change('phone', v)}
        defaultCountry={DEFAULT_COUNTRY}
        placeholder={t('contacts.form.phonePlaceholder')}
        locale={i18n.language}
        error={error('phone')}
        inputRef={phoneInput}
        codeLabel={t('contacts.form.countryCode')}
        searchLabel={t('contacts.form.countrySearch')}
        clearLabel={t('common.clear')}
        closeLabel={t('common.back')}
        emptyLabel={t('common.filters.noMatch')}
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => emailInput.current?.focus()}
      />
      <TextField
        label={t('contacts.form.email')}
        placeholder={t('auth.emailPlaceholder')}
        value={values.email}
        onChangeText={(v) => change('email', v)}
        error={error('email')}
        inputRef={emailInput}
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        inputMode="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      {extra}
      <Button label={submitLabel} loading={pending} onPress={submit} />
      {onCancel ? (
        <Button variant="link" label={t('contacts.cancel')} disabled={pending} onPress={onCancel} />
      ) : null}
    </View>
  );
}

/** What the form starts from when it edits a contact: the name, phone and email as the API has them. */
export function valuesOf(contact: {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
}): ContactFormValues {
  const name =
    contact.name?.trim() || `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim();
  return { name, phone: contact.phone ?? '', email: contact.email ?? '' };
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
});
