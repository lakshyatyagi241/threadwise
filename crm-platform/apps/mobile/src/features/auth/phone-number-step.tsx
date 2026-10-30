import type { CountryCode } from 'libphonenumber-js';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/ui/fade-in';
import { OrDivider } from '@/components/ui/or-divider';
import { PhoneField } from '@/components/ui/phone-field';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';

interface Props {
  defaultCountry: CountryCode;
  pending: boolean;
  error: string | null;
  fieldError?: string;
  onSubmit: (phone: string) => void;
  onBack: () => void;
}

/**
 * The first step of signing in with a mobile number: the country code and the number, then "Send code". The way back to the email
 * and password form is the grey "Continue with Email" under an "OR", as on the Geta app.
 */
export function PhoneNumberStep({
  defaultCountry,
  pending,
  error,
  fieldError,
  onSubmit,
  onBack,
}: Props) {
  const { t, i18n } = useTranslation();
  const [phone, setPhone] = useState('');
  return (
    <FadeIn key="phone">
      <Card>
        <View style={styles.header}>
          <Text variant="title" accessibilityRole="header">
            {t('auth.phone.title')}
          </Text>
          <Text muted>{t('auth.phone.subtitle')}</Text>
        </View>
        {error ? <Banner tone="danger" message={error} /> : null}
        <PhoneField
          label={t('auth.phone.number')}
          value={phone}
          onChangeText={setPhone}
          defaultCountry={defaultCountry}
          locale={i18n.language}
          error={fieldError}
          hint={t('auth.phone.hint')}
          placeholder={t('contacts.form.phonePlaceholder')}
          codeLabel={t('contacts.form.countryCode')}
          searchLabel={t('contacts.form.countrySearch')}
          clearLabel={t('common.clear')}
          closeLabel={t('common.back')}
          emptyLabel={t('common.filters.noMatch')}
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="go"
          onSubmitEditing={() => onSubmit(phone)}
        />
        <Button
          label={t('auth.phone.send')}
          testID="phone-send-code"
          loading={pending}
          onPress={() => onSubmit(phone)}
        />
        <OrDivider label={t('auth.phone.or')} />
        <Button
          variant="soft"
          label={t('auth.phone.continueEmail')}
          disabled={pending}
          onPress={onBack}
        />
      </Card>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
});
