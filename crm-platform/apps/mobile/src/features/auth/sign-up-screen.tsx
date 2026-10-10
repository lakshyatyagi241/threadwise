import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/ui/fade-in';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { spacing } from '@/lib/theme/tokens';
import { AuthFrame } from './auth-frame';
import { OtpStep } from './otp-step';
import { policyParts } from './password-rules';
import { pickDefaultCountry } from './phone';
import { SignUpForm } from './sign-up-form';
import type { SignUpValues } from './sign-up-validation';
import { usePasswordPolicy, useRegistrationConfig } from './use-registration-config';
import { useSignUp } from './use-sign-up';

const EMPTY: SignUpValues = {
  fullName: '',
  email: '',
  orgName: '',
  orgSlug: '',
  customSlug: false,
  phone: '',
  referral: '',
  password: '',
  confirmPassword: '',
  acceptTerms: false,
};

/**
 * Sign-up (TW-AUTH-005 and 006): creates a workspace and its first user. The platform's public settings decide what the person sees:
 * a closed registration or a CAPTCHA the app cannot pass is explained instead of showing a form that cannot work, and with a WhatsApp
 * code switched on the form is followed by the code step. The typed values live here, so going back from the code step keeps them.
 */
export function SignUpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const config = useRegistrationConfig();
  const passwordPolicy = usePasswordPolicy();
  const signUp = useSignUp();
  const [values, setValues] = useState<SignUpValues>(EMPTY);

  const goSignIn = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/sign-in');
  };
  const brandName = config.data?.appName;

  if (signUp.step.kind === 'otp') {
    return (
      <AuthFrame
        brandName={brandName}
        tagline={t('signUp.otp.title')}
        caption={t('signUp.otp.subtitle')}
        onBack={signUp.goBackToForm}
      >
        <OtpStep
          step={signUp.step}
          pending={signUp.pending}
          resending={signUp.resending}
          resent={signUp.resent}
          error={signUp.codeError}
          onVerify={signUp.verify}
          onResend={() => void signUp.resend()}
          onBack={signUp.goBackToForm}
        />
      </AuthFrame>
    );
  }

  // A notice is one card: the page title, why the form is not shown, and the way out.
  const notice = (banner: ReactNode, action: { label: string; onPress: () => void }) => (
    <FadeIn key="notice">
      <Card>
        <View style={styles.header}>
          <Text variant="title" accessibilityRole="header">
            {t('signUp.title')}
          </Text>
          <Text muted>{t('signUp.subtitle')}</Text>
        </View>
        {banner}
        <Button variant="secondary" label={action.label} onPress={action.onPress} />
      </Card>
    </FadeIn>
  );

  let content: ReactNode;
  if (config.isPending) {
    content = (
      <Card>
        <View style={styles.centered}>
          <ActivityIndicator accessibilityLabel={t('common.loading')} />
        </View>
      </Card>
    );
  } else if (config.isError) {
    content = notice(<Banner tone="danger" message={messageForError(config.error, t)} />, {
      label: t('common.retry'),
      onPress: () => void config.refetch(),
    });
  } else if (!config.data.registrationOpen) {
    content = notice(<Banner tone="warning" message={t('signUp.closedBody')} />, {
      label: t('signUp.closedBack'),
      onPress: goSignIn,
    });
  } else if (config.data.captcha) {
    // The platform asks every sign-up for a CAPTCHA (reCAPTCHA). A phone app cannot produce that token yet (ADR-0023): say so now,
    // instead of letting the person fill in a long form that the server is certain to refuse.
    content = notice(<Banner tone="warning" message={t('errors.captchaUnsupported')} />, {
      label: t('signUp.closedBack'),
      onPress: goSignIn,
    });
  } else {
    const showSlug = values.customSlug || signUp.slugConflict;
    const defaultCountry = pickDefaultCountry(config.data.defaultCountryIso);
    const policy = policyParts(passwordPolicy.data);
    content = (
      <SignUpForm
        values={values}
        onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        onEdit={signUp.clearFieldError}
        policy={policy}
        defaultCountry={defaultCountry}
        links={config.data.links}
        pending={signUp.pending}
        banner={signUp.banner}
        fieldErrors={signUp.fieldErrors}
        showSlug={showSlug}
        onSubmit={() =>
          signUp.submit(
            { ...values, customSlug: showSlug },
            { minLength: policy.min, defaultCountry },
          )
        }
        onSignIn={goSignIn}
      />
    );
  }

  return (
    <AuthFrame brandName={brandName} tagline={t('signUp.tagline')} compact onBack={goSignIn}>
      {content}
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  centered: { paddingVertical: spacing.xl, alignItems: 'center' },
  header: { gap: spacing.xs },
});
