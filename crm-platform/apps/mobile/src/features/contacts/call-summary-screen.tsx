import { createContactActivitySchema } from '@crm/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { HeaderIconButton } from '@/components/ui/screen-header';
import { Icon } from '@/components/ui/icon';
import { SelectField } from '@/components/ui/select-field';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { takeEndedCall } from '@/lib/device/call-monitor';
import { forgetCall } from '@/lib/device/pending-call';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { formatMoment } from './contact-display';
import { formatDuration, parseDuration, wholeNumber } from './call-summary-support';
import { firstParam, joinMeta } from './record-support';
import { useCreateActivity } from './use-activity';

type Status = 'completed' | 'notAnswered';

const PURPOSES = [
  'prospecting',
  'administrative',
  'negotiation',
  'demo',
  'project',
  'desk',
] as const;
type Purpose = 'none' | (typeof PURPOSES)[number];

interface RowProps {
  label: string;
  /** Marks the row as required (a red star before the label). */
  required?: boolean;
  /** The phone measured this value; it is shown but not changed here. */
  locked?: boolean;
  error?: string;
  children: ReactNode;
}

/** One line of the form: the label on the left, the value on the right, a rule under it (a lock when the value is fixed). */
function FormRow({ label, required, locked, error, children }: RowProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={styles.rowLabel}>
        <Text variant="label" muted style={styles.rowLabelText}>
          {required ? (
            <Text variant="label" danger>
              {'* '}
            </Text>
          ) : null}
          {label}
        </Text>
      </View>
      <View style={styles.rowValue}>
        <View style={styles.rowInput}>
          <View style={styles.fill}>{children}</View>
          {locked ? <Icon name="lock-closed" size={18} color="textMuted" /> : null}
        </View>
        {error ? (
          <Text variant="caption" danger accessibilityLiveRegion="polite" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The "Add call" page that opens when a call placed from the app ends (/call-summary?contactId=…&name=…&startedAt=…&durationSec=…):
 * the call as the phone saw it (contact, type, start, length), to be completed with a subject, the outcome, a purpose, a result
 * and notes, then saved on the contact's timeline as a "call". On Android the call-monitor service opens it the moment the call
 * ends; elsewhere the app opens it when the person comes back to the app (see `use-call-return`). The length is the time from
 * dialling to hanging up, so it can be changed. Logging needs `record.contacts.update`, like any entry on the timeline.
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
  // Opened without a start time (it always has one): the moment the page opened, kept for as long as it is open.
  const [openedAt] = useState(() => Date.now());
  const startedAt = wholeNumber(firstParam(params.startedAt), openedAt);
  const create = useCreateActivity(contactId);
  // This call is on screen now: the app must not offer it a second time when the person comes back to it (`use-call-return`).
  useEffect(() => {
    takeEndedCall();
    forgetCall();
  }, []);

  const [status, setStatus] = useState<Status>('completed');
  const [purpose, setPurpose] = useState<Purpose>('none');
  const [duration, setDuration] = useState(
    formatDuration(wholeNumber(firstParam(params.durationSec), 0)),
  );
  const [subject, setSubject] = useState(t('calls.summary.subjectDefault', { name }));
  const [result, setResult] = useState('');
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
    const outcome = result.trim();
    const details = notes.trim();
    const parsed = createContactActivitySchema.safeParse({
      activityType: 'call',
      title,
      body:
        joinMeta([
          t('calls.summary.outbound'),
          t(`calls.summary.${status}`),
          seconds === null ? null : formatDuration(seconds),
          purpose === 'none' ? null : t(`calls.summary.purposes.${purpose}`),
        ]) +
        (outcome ? `\n${t('calls.summary.result')}: ${outcome}` : '') +
        (details ? `\n${details}` : ''),
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

  const canLog =
    session.data !== undefined && contactId !== '' && can(session.data, 'record.contacts.update');

  let body;
  if (session.data === undefined) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (!canLog) {
    body = (
      <View style={styles.message}>
        <Text muted>
          {contactId === '' ? t('calls.summary.contactMissing') : t('calls.summary.denied')}
        </Text>
        <Button variant="secondary" label={t('calls.summary.skip')} onPress={close} />
      </View>
    );
  } else {
    body = (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {failure ? (
          <View style={styles.banner}>
            <Banner tone="danger" message={failure} />
          </View>
        ) : null}
        <FormRow label={t('calls.summary.contact')}>
          <Text style={styles.valueText}>{name}</Text>
        </FormRow>
        <FormRow label={t('calls.summary.type')} required locked>
          <Text style={styles.valueText}>{t('calls.summary.outbound')}</Text>
        </FormRow>
        <FormRow label={t('calls.summary.status')}>
          <SelectField
            variant="plain"
            label={t('calls.summary.status')}
            placeholder={t('calls.summary.completed')}
            options={[
              { value: 'completed', label: t('calls.summary.completed') },
              { value: 'notAnswered', label: t('calls.summary.notAnswered') },
            ]}
            value={status}
            onChange={(value) => setStatus(value === 'notAnswered' ? 'notAnswered' : 'completed')}
          />
        </FormRow>
        <FormRow label={t('calls.summary.startTime')} required locked>
          <Text style={styles.valueText}>
            {formatMoment(new Date(startedAt).toISOString(), i18n.language) ?? ''}
          </Text>
        </FormRow>
        <FormRow label={t('calls.summary.duration')} required error={errors.duration}>
          <TextField
            bare
            label={t('calls.summary.duration')}
            hint={t('calls.summary.durationHint')}
            value={duration}
            onChangeText={setDuration}
            error={errors.duration}
            keyboardType="numbers-and-punctuation"
            maxLength={9}
          />
        </FormRow>
        <FormRow label={t('calls.summary.subject')} error={errors.subject}>
          <TextField
            bare
            label={t('calls.summary.subject')}
            value={subject}
            onChangeText={setSubject}
            error={errors.subject}
            maxLength={255}
          />
        </FormRow>
        <FormRow label={t('calls.summary.purpose')}>
          <SelectField
            variant="plain"
            label={t('calls.summary.purpose')}
            placeholder={t('calls.summary.purposeNone')}
            options={[
              { value: 'none', label: t('calls.summary.purposeNone') },
              ...PURPOSES.map((value) => ({
                value,
                label: t(`calls.summary.purposes.${value}`),
              })),
            ]}
            value={purpose}
            onChange={(value) => setPurpose(PURPOSES.find((p) => p === value) ?? 'none')}
          />
        </FormRow>
        <FormRow label={t('calls.summary.result')}>
          <TextField
            bare
            label={t('calls.summary.result')}
            value={result}
            onChangeText={setResult}
            maxLength={500}
          />
        </FormRow>
        <FormRow label={t('calls.summary.notes')}>
          <TextField
            bare
            label={t('calls.summary.notes')}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={5000}
          />
        </FormRow>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.fill, { backgroundColor: colors.surface }]}>
      <StackHeader
        title={t('calls.summary.title')}
        onBack={close}
        actions={
          canLog ? (
            <HeaderIconButton icon="checkmark" label={t('calls.summary.save')} onPress={save} />
          ) : undefined
        }
      />
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { marginVertical: spacing.xl },
  message: { padding: spacing.lg, gap: spacing.lg },
  banner: { padding: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET + spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginRight: spacing.lg,
  },
  rowLabel: { width: '36%', paddingHorizontal: spacing.md },
  rowLabelText: { textAlign: 'right' },
  rowValue: { flex: 1, paddingLeft: spacing.md, paddingVertical: spacing.xs },
  rowInput: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  valueText: { paddingVertical: spacing.md },
});
