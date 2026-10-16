import { ACTIVITY_BODY_MAX, type CreateDealActivityInput } from '@crm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextField } from '@/components/ui/text-field';
import { parseDateText, parseTimeText, toDueAt } from '@/lib/format/dates';
import { spacing } from '@/lib/theme/tokens';

/** The kinds a person adds from the phone, the same three the web offers: a note, a logged call and a follow-up task. */
export const NEW_TYPES = ['note', 'call', 'task'] as const;
export type NewType = (typeof NEW_TYPES)[number];

/** A task without a time is due at this hour of its day, as on the web. */
const DEFAULT_TASK_TIME = '09:00';

interface Props {
  pending: boolean;
  /** Why the last try failed, in the person's language. */
  error?: string | null;
  /** Called with a body the API's schema accepts; the composer empties itself when the answer is a success (`resetKey`). */
  onAdd: (body: CreateDealActivityInput) => void;
  /** Changes when an entry was added, which empties the fields. */
  resetKey: number;
}

type Problem = 'dateInvalid' | 'timeInvalid' | null;

/** The box above the timeline: pick a note, call or task, write it, and add it. A task can carry a day and a time. */
export function ActivityComposer({ resetKey, ...rest }: Props) {
  return <Composer key={resetKey} {...rest} />;
}

function Composer({ pending, error, onAdd }: Omit<Props, 'resetKey'>) {
  const { t } = useTranslation();
  const [type, setType] = useState<NewType>('note');
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [problem, setProblem] = useState<Problem>(null);

  const submit = () => {
    const body = text.trim();
    if (!body || pending) return;
    if (type !== 'task') {
      onAdd({ type, body });
      return;
    }
    const day = date.trim();
    if (day === '') {
      onAdd({ type, body });
      return;
    }
    if (!parseDateText(day)) return setProblem('dateInvalid');
    if (time.trim() !== '' && !parseTimeText(time)) return setProblem('timeInvalid');
    const dueAt = toDueAt(day, time.trim() || DEFAULT_TASK_TIME);
    if (!dueAt) return setProblem('dateInvalid');
    setProblem(null);
    onAdd({ type, body, dueAt });
  };

  return (
    <View style={styles.box}>
      {error ? <Banner tone="danger" message={error} /> : null}
      <SegmentedControl
        label={t('deals.timeline.type')}
        value={type}
        onChange={setType}
        options={NEW_TYPES.map((value) => ({ value, label: t(`deals.timeline.types.${value}`) }))}
      />
      <TextField
        label={t('deals.timeline.placeholder')}
        placeholder={t('deals.timeline.placeholder')}
        value={text}
        onChangeText={setText}
        maxLength={ACTIVITY_BODY_MAX}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
        autoCapitalize="sentences"
      />
      {type === 'task' ? (
        <>
          <TextField
            label={t('deals.timeline.date')}
            hint={t('deals.timeline.dateHint')}
            value={date}
            onChangeText={(v) => {
              setDate(v);
              setProblem(null);
            }}
            error={problem === 'dateInvalid' ? t('deals.timeline.dateInvalid') : null}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextField
            label={t('deals.timeline.time')}
            hint={t('deals.timeline.timeHint')}
            value={time}
            onChangeText={(v) => {
              setTime(v);
              setProblem(null);
            }}
            error={problem === 'timeInvalid' ? t('deals.timeline.timeInvalid') : null}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : null}
      <Button
        label={t('deals.timeline.add')}
        loading={pending}
        disabled={pending || text.trim() === ''}
        onPress={submit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.md },
});
