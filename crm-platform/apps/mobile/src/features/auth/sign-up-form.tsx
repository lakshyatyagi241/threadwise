import type { RegistrationConfigResponse } from '@crm/contracts';
import type { CountryCode } from 'libphonenumber-js';
import { useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FadeIn } from '@/components/ui/fade-in';
import { PasswordField } from '@/components/ui/password-field';
import { Text } from '@/components/ui/text';
import { TextField, type TextFieldHandle } from '@/components/ui/text-field';
import { spacing } from '@/lib/theme/tokens';
import { LegalText, plainText } from './legal-text';
import { PasswordChecklist } from './password-checklist';
import type { PolicyParts } from './password-rules';
import { callingCodeOf, formatPhone } from './phone';
import { sanitizeReferral } from './referral';
import { SIGN_UP_FIELD_ORDER, type SignUpField, type SignUpValues } from './sign-up-validation';
import { suggestSlug } from './slug';

interface Props {
  values: SignUpValues;
  onChange: (patch: Partial<SignUpValues>) => void;
  /** Called when the person edits a field, so its error message can go away. */
  onEdit: (field: SignUpField) => void;
  policy: PolicyParts;
  defaultCountry: CountryCode;
  links: RegistrationConfigResponse['links'];
  pending: boolean;
  banner: string | null;
  fieldErrors: Partial<Record<SignUpField, string>>;
  /** The workspace address field is open: the person asked for it, or the server refused the derived address. */
  showSlug: boolean;
  /** Sends the form; resolves to the field that needs attention (to move focus there), or null. */
  onSubmit: () => Promise<SignUpField | null>;
  onSignIn: () => void;
}

/**
 * The sign-up form (TW-AUTH-005): the same fields as the web, in the same order, rearranged for a phone. The keyboard's "next"
 * key walks down the form, and a refused submit puts the cursor on the first field that needs fixing.
 */
export function SignUpForm({
  values,
  onChange,
  onEdit,
  policy,
  defaultCountry,
  links,
  pending,
  banner,
  fieldErrors,
  showSlug,
  onSubmit,
  onSignIn,
}: Props) {
  const { t } = useTranslation();
  const suggested = suggestSlug(values.orgName);

  // One ref per field: the keyboard's "next" key and a refused submit move focus between them (only ever in event handlers).
  const fullName = useRef<TextFieldHandle>(null);
  const email = useRef<TextFieldHandle>(null);
  const orgName = useRef<TextFieldHandle>(null);
  const orgSlug = useRef<TextFieldHandle>(null);
  const phone = useRef<TextFieldHandle>(null);
  const referralCode = useRef<TextFieldHandle>(null);
  const password = useRef<TextFieldHandle>(null);
  const confirmPassword = useRef<TextFieldHandle>(null);
  const inputs: Partial<Record<SignUpField, RefObject<TextFieldHandle | null>>> = {
    fullName,
    email,
    orgName,
    orgSlug,
    phone,
    referralCode,
    password,
    confirmPassword,
  };

  const edit = (field: SignUpField, patch: Partial<SignUpValues>) => {
    onChange(patch);
    onEdit(field);
  };
  const focusNext = (field: SignUpField) => {
    const order = SIGN_UP_FIELD_ORDER.filter(
      (f) => f !== 'acceptTerms' && (f !== 'orgSlug' || showSlug),
    );
    const target = order[order.indexOf(field) + 1];
    if (target) inputs[target]?.current?.focus();
  };
  const submit = async () => {
    const field = await onSubmit();
    if (field) inputs[field]?.current?.focus();
  };

  return (
    <>
      <FadeIn>
        <Card>
          <View style={styles.header}>
            <Text variant="title" accessibilityRole="header">
              {t('signUp.title')}
            </Text>
            <Text muted>{t('signUp.subtitle')}</Text>
          </View>
          {banner ? <Banner tone="danger" message={banner} testID="sign-up-banner" /> : null}
          <TextField
            label={t('signUp.fullName')}
            value={values.fullName}
            onChangeText={(fullName) => edit('fullName', { fullName })}
            error={fieldErrors.fullName}
            inputRef={fullName}
            placeholder={t('signUp.fullNamePlaceholder')}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => focusNext('fullName')}
          />
          <TextField
            label={t('signUp.email')}
            value={values.email}
            onChangeText={(email) => edit('email', { email })}
            error={fieldErrors.email}
            inputRef={email}
            placeholder={t('auth.emailPlaceholder')}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            inputMode="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => focusNext('email')}
          />
          <TextField
            label={t('signUp.orgName')}
            value={values.orgName}
            onChangeText={(orgName) => edit('orgName', { orgName })}
            error={fieldErrors.orgName}
            hint={
              suggested
                ? t('signUp.orgNameHint', { slug: suggested })
                : t('signUp.orgNameHintEmpty')
            }
            inputRef={orgName}
            placeholder={t('signUp.orgNamePlaceholder')}
            autoCapitalize="words"
            textContentType="organizationName"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => focusNext('orgName')}
          />
          {showSlug ? (
            <TextField
              label={t('signUp.orgSlug')}
              value={values.orgSlug}
              onChangeText={(orgSlug) => edit('orgSlug', { orgSlug })}
              error={fieldErrors.orgSlug}
              hint={t('signUp.orgSlugHint')}
              inputRef={orgSlug}
              placeholder={suggested || t('signUp.orgSlugPlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => focusNext('orgSlug')}
            />
          ) : (
            <Button
              variant="link"
              align="start"
              label={t('signUp.customiseSlug')}
              onPress={() => onChange({ customSlug: true })}
            />
          )}
          <TextField
            label={t('signUp.phone')}
            value={values.phone}
            onChangeText={(phone) => edit('phone', { phone })}
            onBlur={() => onChange({ phone: formatPhone(values.phone, defaultCountry) })}
            error={fieldErrors.phone}
            hint={t('signUp.phoneHint')}
            inputRef={phone}
            placeholder={callingCodeOf(defaultCountry)}
            autoComplete="tel"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => focusNext('phone')}
          />
          <TextField
            label={t('signUp.referral')}
            value={values.referral}
            onChangeText={(referral) =>
              edit('referralCode', { referral: sanitizeReferral(referral) })
            }
            error={fieldErrors.referralCode}
            inputRef={referralCode}
            placeholder={t('signUp.referralPlaceholder')}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect={false}
            maxLength={16}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => focusNext('referralCode')}
          />
          <PasswordField
            label={t('auth.password')}
            value={values.password}
            onChangeText={(password) => edit('password', { password })}
            error={fieldErrors.password}
            inputRef={password}
            placeholder={t('signUp.passwordPlaceholder')}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => focusNext('password')}
          />
          <PasswordChecklist password={values.password} parts={policy} />
          <PasswordField
            label={t('signUp.confirmPassword')}
            value={values.confirmPassword}
            onChangeText={(confirmPassword) => edit('confirmPassword', { confirmPassword })}
            error={fieldErrors.confirmPassword}
            inputRef={confirmPassword}
            placeholder={t('signUp.confirmPasswordPlaceholder')}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
          <View>
            <View style={styles.terms}>
              <Checkbox
                checked={values.acceptTerms}
                onChange={(acceptTerms) => edit('acceptTerms', { acceptTerms })}
                label={plainText(t('signUp.agree'))}
                invalid={Boolean(fieldErrors.acceptTerms)}
              />
              <View style={styles.termsText}>
                <LegalText i18nKey="signUp.agree" links={links} />
              </View>
            </View>
            {fieldErrors.acceptTerms ? (
              <Text
                variant="caption"
                danger
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                {fieldErrors.acceptTerms}
              </Text>
            ) : null}
          </View>
          <Button
            label={t('signUp.submit')}
            testID="sign-up-submit"
            loading={pending}
            onPress={() => void submit()}
          />
        </Card>
      </FadeIn>
      <FadeIn delay={140}>
        <View style={styles.footer}>
          <Text muted>{t('signUp.haveAccount')}</Text>
          <Button variant="link" label={t('signUp.signIn')} onPress={onSignIn} disabled={pending} />
        </View>
      </FadeIn>
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  terms: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  termsText: { flex: 1 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
});
