import {
  phoneSchema,
  ERROR_CODES,
  type ProfileResponse,
  type UpdateProfileRequest,
} from '@crm/contracts';
import { useRouter } from 'expo-router';
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
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField, type TextFieldHandle } from '@/components/ui/text-field';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { useProfile, useUpdateProfile } from './use-profile';

const NAME_MAX = 120;

type Field = 'fullName' | 'displayName' | 'phone';
type Messages = Partial<Record<Field, string>>;

/** A phone as people type it ("+91 98765-43210") becomes the digits the API takes ("+919876543210"). */
const normalisePhone = (raw: string): string => raw.replace(/[\s().-]/g, '');

/**
 * Manage profile: the person's own name, display name and phone, saved to their account (`PATCH /v2/account/profile`). The email
 * and the workspace time zone are shown but not edited here: a new email needs the password and a confirmation from the new
 * address, and the time zone belongs to the workspace owner.
 */
export function ManageProfileScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const profile = useProfile();

  const back = () => (router.canGoBack() ? router.back() : router.replace('/menu'));

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('menu.profile.title')} onBack={back} />
      {profile.data ? (
        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <ProfileForm profile={profile.data} onDone={back} onCancel={back} />
          </ScrollView>
        </KeyboardAvoidingView>
      ) : profile.error ? (
        <View style={styles.content}>
          <Card>
            <View style={styles.stack}>
              <Text danger accessibilityRole="alert">
                {messageForError(profile.error, t)}
              </Text>
              <Button
                variant="secondary"
                label={t('common.retry')}
                onPress={() => void profile.refetch()}
              />
            </View>
          </Card>
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator accessibilityLabel={t('common.loading')} />
        </View>
      )}
    </View>
  );
}

function ProfileForm({
  profile,
  onDone,
  onCancel,
}: {
  profile: ProfileResponse;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateProfile();
  const [fullName, setFullName] = useState(profile.fullName);
  const [displayName, setDisplayName] = useState(profile.displayName ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [checked, setChecked] = useState<Messages>({});
  const [refused, setRefused] = useState<Messages>({});
  const [banner, setBanner] = useState<string | null>(null);
  const displayInput = useRef<TextFieldHandle>(null);
  const phoneInput = useRef<TextFieldHandle>(null);

  const error = (field: Field) => checked[field] ?? refused[field];
  const edit = (field: Field, set: (value: string) => void) => (value: string) => {
    set(value);
    setChecked({ ...checked, [field]: undefined });
    setRefused({ ...refused, [field]: undefined });
  };

  const submit = () => {
    setBanner(null);
    const problems: Messages = {};
    const name = fullName.trim();
    const shown = displayName.trim();
    const number = normalisePhone(phone);
    if (name === '') problems.fullName = t('menu.profile.nameRequired');
    else if (name.length > NAME_MAX) problems.fullName = t('menu.profile.nameTooLong');
    if (shown.length > NAME_MAX) problems.displayName = t('menu.profile.nameTooLong');
    if (number !== '' && !phoneSchema.safeParse(number).success) {
      problems.phone = t('menu.profile.phoneInvalid');
    }
    setChecked(problems);
    if (Object.keys(problems).length > 0) return;

    // Only what changed is sent; a blank display name or phone clears it.
    const body: UpdateProfileRequest = {
      ...(name !== profile.fullName ? { fullName: name } : {}),
      ...((shown || null) !== profile.displayName ? { displayName: shown || null } : {}),
      ...((number || null) !== profile.phone ? { phone: number || null } : {}),
    };
    if (Object.keys(body).length === 0) {
      onDone();
      return;
    }
    update.mutate(body, {
      onSuccess: onDone,
      onError: (failure) => {
        const named: Messages = {};
        if (isApiError(failure) && failure.code === ERROR_CODES.VALIDATION_FAILED) {
          for (const detail of failure.fieldErrors) {
            if (detail.path === 'fullName') named.fullName = t('menu.profile.nameRequired');
            else if (detail.path === 'displayName')
              named.displayName = t('menu.profile.nameTooLong');
            else if (detail.path === 'phone') named.phone = t('menu.profile.phoneInvalid');
          }
        }
        setRefused(named);
        if (Object.keys(named).length === 0) setBanner(messageForError(failure, t));
      },
    });
  };

  return (
    <View style={styles.stack}>
      {banner ? <Banner tone="danger" message={banner} /> : null}
      <TextField
        label={t('menu.profile.fullName')}
        value={fullName}
        onChangeText={edit('fullName', setFullName)}
        error={error('fullName')}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => displayInput.current?.focus()}
      />
      <TextField
        label={t('menu.profile.displayName')}
        hint={t('menu.profile.displayNameHint')}
        value={displayName}
        onChangeText={edit('displayName', setDisplayName)}
        error={error('displayName')}
        inputRef={displayInput}
        autoCapitalize="words"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => phoneInput.current?.focus()}
      />
      <TextField
        label={t('menu.profile.phone')}
        hint={t('menu.profile.phoneHint')}
        value={phone}
        onChangeText={edit('phone', setPhone)}
        error={error('phone')}
        inputRef={phoneInput}
        autoComplete="tel"
        inputMode="tel"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        returnKeyType="done"
        onSubmitEditing={submit}
      />

      <ReadOnly label={t('menu.profile.email')} value={profile.email} />
      {profile.pendingEmail ? (
        <Banner
          tone="info"
          message={t('menu.profile.pendingEmail', { email: profile.pendingEmail })}
        />
      ) : null}
      {profile.workspaceTimezone ? (
        <ReadOnly label={t('menu.profile.timezone')} value={profile.workspaceTimezone} />
      ) : null}

      <Button label={t('menu.profile.save')} loading={update.isPending} onPress={submit} />
      <Button
        variant="link"
        label={t('menu.profile.cancel')}
        disabled={update.isPending}
        onPress={onCancel}
      />
    </View>
  );
}

/** A value that is shown and not edited here: the label above, the value under it. */
function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.readOnly}>
      <Text variant="label">{label}</Text>
      <Text muted>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  stack: { gap: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  readOnly: { gap: spacing.xs },
});
