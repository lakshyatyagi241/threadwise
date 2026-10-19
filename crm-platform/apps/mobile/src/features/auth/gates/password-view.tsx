import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/ui/fade-in';
import { PasswordField } from '@/components/ui/password-field';
import type { TextFieldHandle } from '@/components/ui/text-field';
import { spacing } from '@/lib/theme/tokens';
import { PasswordChecklist } from '@/features/auth/password-checklist';
import { policyParts } from '@/features/auth/password-rules';
import { usePasswordPolicy } from '@/features/auth/use-registration-config';
import { GateFrame } from './gate-frame';
import { useChangePassword } from './use-change-password';

/**
 * The forced password change lock screen (TW-AUTH-035): an administrator forced a reset, or the password is older than the
 * workspace allows. The API leaves the password route open while it is the only thing the person can do.
 */
export function PasswordView() {
  const { t } = useTranslation();
  const policy = usePasswordPolicy();
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const nextInput = useRef<TextFieldHandle>(null);
  const confirmInput = useRef<TextFieldHandle>(null);
  const parts = policyParts(policy.data);
  const send = () => void change.submit(current, next, confirm, parts);

  return (
    <GateFrame title={t('gates.password.title')} signOutDisabled={change.pending}>
      <FadeIn>
        <Card>
          <Banner tone="info" message={t('gates.password.banner')} />
          {change.banner ? <Banner tone="danger" message={change.banner} /> : null}
          <PasswordField
            label={t('gates.password.current')}
            value={current}
            onChangeText={setCurrent}
            error={change.fieldErrors.current}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => nextInput.current?.focus()}
          />
          <View style={styles.group}>
            <PasswordField
              label={t('gates.password.new')}
              value={next}
              onChangeText={setNext}
              error={change.fieldErrors.next}
              inputRef={nextInput}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => confirmInput.current?.focus()}
            />
            <PasswordChecklist password={next} parts={parts} />
          </View>
          <PasswordField
            label={t('gates.password.confirm')}
            value={confirm}
            onChangeText={setConfirm}
            error={change.fieldErrors.confirm}
            inputRef={confirmInput}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={send}
          />
          <Button
            label={t('gates.password.submit')}
            testID="gate-password-submit"
            loading={change.pending}
            onPress={send}
          />
        </Card>
      </FadeIn>
    </GateFrame>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.md } });
