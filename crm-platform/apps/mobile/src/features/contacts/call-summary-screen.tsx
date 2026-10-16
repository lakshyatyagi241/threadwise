import { createContactActivitySchema } from '@crm/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { formatMoment } from './contact-display';
import { formatDuration, parseDuration, wholeNumber } from './call-summary-support';
import { firstParam, joinMeta } from './record-support';
import { useCreateActivity } from './use-activity';

type Status = 'completed' | 'notAnswered';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="label" muted style={styles.rowLabel}>
        {label}
      </Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/**
 * The sheet that opens when a call placed from the app ends (/call-summary?contactId=…&name=…&startedAt=…&durationSec=…): the
 * call as the phone saw it, to be completed with a subject, the outcome and notes, then saved on the contact's timeline as a "call".
 * On Android the call-monitor service opens it the moment the call ends; elsewhere the app opens it when the person comes back
 * to the app (see `use-call-return`). The length is the time from dialling to hanging up, so it can be changed. Logging needs
 * `record.contacts.update`, like any entry on the timeline.
 */
export function CallSummaryScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const session = useSession();
  const params = useLocalSearchParams<{
    contactId?: string | string[];
    name?: string | string[];
    startedAt?: string | string[];
    durationSec?: string | string[];
  }>();
  const contactId = firstParam(params.contactId);
  const name = firstParam(params.name);
  // Opened without a start time (it always has one): the moment the sheet opened, kept for as long as it is open.
  const [openedAt] = useState(() => Date.now());
  const startedAt = wholeNumber(firstParam(params.startedAt), openedAt);
  const create = useCreateActivity(contactId);

  const [status, setStatus] = useState<Status>('completed');
  const [duration, setDuration] = useState(
    formatDuration(wholeNumber(firstParam(params.durationSec), 0)),
  );
  const [subject, setSubject] = useState(t('calls.summary.subjectDefault', { name }));
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<{ duration?: string; subject?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const save = () => {
    if (create.isPending) return;
    setFailure(null);
    const seconds = parseDuration(duration);
    const title = subject.trim();
    const next: typeof errors = {};
    if (seconds === null) next.duration = t('calls.summary.durationInvalid');
    if (title === '') next.subject = t('calls.summary.subjectInvalid');
    const details = notes.trim();
    const parsed = createContactActivitySchema.safeParse({
      activityType: 'call',
      title,
      body:
        joinMeta([
          t('calls.summary.outbound'),
          t(`calls.summary.${status}`),
          seconds === null ? null : formatDuration(seconds),
        ]) + (details ? `\n${details}` : ''),
      occurredAt: new Date(startedAt).toISOString(),
    });
    if (!parsed.success && !next.subject) next.subject = t('calls.summary.subjectInvalid');
    setErrors(next);
    if (!parsed.success || Object.keys(next).length > 0) return;
    create.mutate(parsed.data, {
      onSuccess: close,
      onError: (error) => setFailure(messageForError(error, t)),
    });
  };

  let body;
  if (session.data === undefined) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (contactId === '' || !can(session.data, 'record.contacts.update')) {
    body = (
      <>
        <Text muted>
          {contactId === '' ? t('calls.summary.contactMissing') : t('calls.summary.denied')}
        </Text>
        <Button variant="secondary" label={t('calls.summary.skip')} onPress={close} />
      </>
    );
  } else {
    body = (
      <>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {failure ? <Banner tone="danger" message={failure} /> : null}
          <Row label={t('calls.summary.contact')} value={name} />
          <Row label={t('calls.summary.type')} value={t('calls.summary.outbound')} />
          <Row
            label={t('calls.summary.startTime')}
            value={formatMoment(new Date(startedAt).toISOString(), i18n.language) ?? ''}
          />
          <SegmentedControl
            label={t('calls.summary.status')}
            options={[
              { value: 'completed', label: t('calls.summary.completed') },
              { value: 'notAnswered', label: t('calls.summary.notAnswered') },
            ]}
            value={status}
            onChange={setStatus}
          />
          <TextField
            label={t('calls.summary.duration')}
            hint={t('calls.summary.durationHint')}
            value={duration}
            onChangeText={setDuration}
            error={errors.duration}
            keyboardType="numbers-and-punctuation"
            maxLength={9}
          />
          <TextField
            label={t('calls.summary.subject')}
            value={subject}
            onChangeText={setSubject}
            error={errors.subject}
            maxLength={255}
          />
          <TextField
            label={t('calls.summary.notes')}
            placeholder={t('calls.summary.notesPlaceholder')}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={5000}
          />
        </ScrollView>
        <View style={styles.actions}>
          <Button label={t('calls.summary.save')} loading={create.isPending} onPress={save} />
          <Button variant="link" label={t('calls.summary.skip')} onPress={close} />
        </View>
      </>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior="padding">
      <View style={[styles.scrim, { backgroundColor: colors.scrim }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('calls.summary.skip')}
          onPress={close}
          style={styles.fill}
        />
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="heading" accessibilityRole="header">
            {t('calls.summary.title')}
          </Text>
          {body}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { flex: 1 },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.md,
  },
  form: { gap: spacing.lg, paddingBottom: spacing.md },
  actions: { gap: spacing.sm },
  loading: { marginVertical: spacing.xl },
  row: { flexDirection: 'row', gap: spacing.md },
  rowLabel: { width: 120 },
  rowValue: { flex: 1 },
});
