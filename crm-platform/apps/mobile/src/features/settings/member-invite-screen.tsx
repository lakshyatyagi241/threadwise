import {
  WSP_INVITE_TTL_DAYS,
  WSP_MEMBER_NAME_MAX,
  type InviteWspMemberResponse,
} from '@crm/contracts';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SelectField } from '@/components/ui/select-field';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField, type TextFieldHandle } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { LinkBanner } from './link-banner';
import { memberErrorText } from './member-errors';
import { grantableRoles, seatsLine, validateInvite, type InviteErrors } from './member-rules';
import { useInviteMember, useMembersSummary } from './use-members';

/**
 * Invite a teammate (TW-WSP-017): a name, an email and the role they start with, from the roles the person may give. The server emails a
 * single-use link; when it cannot send mail the answer carries the link, shown once to pass on by hand. Needs `org.member.invite`
 * (the summary says `canInvite`) and a free seat on a plan with a cap.
 */
export function MemberInviteScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const summaryQuery = useMembersSummary();
  const invite = useInviteMember();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [errors, setErrors] = useState<InviteErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [done, setDone] = useState<InviteWspMemberResponse | null>(null);
  const emailInput = useRef<TextFieldHandle>(null);

  const summary = summaryQuery.data;
  const roles = summary ? grantableRoles(summary.roles) : [];
  const seats = seatsLine(summary?.seats);
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/members'));

  const submit = async () => {
    setBanner(null);
    const checked = validateInvite({ fullName, email, roleId: roleId || roles[0]?.id || '' });
    if ('errors' in checked) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    try {
      setDone(await invite.mutateAsync(checked.input));
    } catch (e) {
      setBanner(memberErrorText(e, t, summary?.seats.limit));
    }
  };

  let body;
  if (summaryQuery.isPending) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (summaryQuery.isError) {
    body = (
      <View style={styles.pad}>
        <Banner tone="danger" message={messageForError(summaryQuery.error, t)} />
        <Button
          variant="secondary"
          label={t('common.retry')}
          onPress={() => void summaryQuery.refetch()}
        />
      </View>
    );
  } else if (!summary?.me.canInvite) {
    body = <EmptyState icon="lock-closed-outline" title={t('settings.members.errors.forbidden')} />;
  } else if (done) {
    body = (
      <View style={styles.content}>
        <Banner
          tone="info"
          message={
            done.emailSent
              ? t('settings.members.invited.emailed', {
                  email: done.member.email,
                  count: WSP_INVITE_TTL_DAYS,
                })
              : t('settings.members.invited.added', { name: done.member.fullName })
          }
        />
        {!done.emailSent && done.inviteLink ? (
          <LinkBanner
            title={t('settings.members.linkTitle', { name: done.member.fullName })}
            body={t('settings.members.invited.shareLink')}
            link={done.inviteLink}
            email={done.member.email}
            onDismiss={() => setDone({ ...done, inviteLink: null })}
          />
        ) : null}
        <Button label={t('settings.members.invited.done')} onPress={goBack} />
      </View>
    );
  } else {
    body = (
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text muted>{t('settings.members.invited.intro')}</Text>
          {banner ? <Banner tone="danger" message={banner} /> : null}
          <TextField
            label={t('settings.members.invited.name')}
            value={fullName}
            onChangeText={setFullName}
            error={
              errors.fullName
                ? t(`settings.members.invited.nameErrors.${errors.fullName}`, {
                    max: WSP_MEMBER_NAME_MAX,
                  })
                : undefined
            }
            autoComplete="name"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => emailInput.current?.focus()}
          />
          <TextField
            label={t('settings.members.invited.email')}
            value={email}
            onChangeText={setEmail}
            error={
              errors.email ? t(`settings.members.invited.emailErrors.${errors.email}`) : undefined
            }
            inputRef={emailInput}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            inputMode="email"
            keyboardType="email-address"
            returnKeyType="done"
          />
          <View style={styles.group}>
            <Text variant="label">{t('settings.members.invited.role')}</Text>
            <SelectField
              label={t('settings.members.invited.role')}
              placeholder={t('settings.members.invited.role')}
              value={roleId || roles[0]?.id}
              options={roles.map((r) => ({
                value: r.id,
                label:
                  r.tier === 'custom'
                    ? r.name
                    : t(`settings.members.invited.roleOptions.${r.tier}`),
              }))}
              onChange={setRoleId}
            />
          </View>
          {seats ? (
            <Text variant="caption" color={seats.full ? 'warning' : 'textMuted'}>
              {t(seats.full ? 'settings.members.seatsFull' : 'settings.members.seats', {
                used: seats.used,
                limit: seats.limit,
              })}
            </Text>
          ) : null}
          <Button
            label={t('settings.members.invited.submit')}
            testID="member-invite-submit"
            loading={invite.isPending}
            onPress={() => void submit()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('settings.members.invited.title')} onBack={goBack} />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { marginTop: spacing.xl },
  pad: { gap: spacing.md, padding: spacing.lg },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  group: { gap: spacing.sm },
});
