import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Card } from '@/components/ui/card';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { listContactTasksForSummary } from './task-summary-api';
import { useContactMeetings } from './use-meetings';
import { useContactNotes } from './use-notes';

/** One page is plenty for a count on a summary row; a contact rarely has more open tasks than this. */
const TASK_COUNT_LIMIT = 20;

/** What one page of a list says about the whole: how many rows it holds, and whether there are more past it. */
type PageInfo = { data: unknown[]; page: { hasMore: boolean } };

function countOf(page: PageInfo | undefined): { count: number; atLeast: boolean } | null {
  return page ? { count: page.data.length, atLeast: page.page.hasMore } : null;
}

interface RowProps {
  icon: IconName;
  label: string;
  /** `null` while the count is still loading. */
  info: { count: number; atLeast: boolean } | null;
  disabled?: boolean;
  onPress: () => void;
}

function SummaryRow({ icon, label, info, disabled, onPress }: RowProps) {
  const { t } = useTranslation();
  const countText = info
    ? info.atLeast
      ? t('contacts.detail.summary.atLeast', { count: info.count })
      : String(info.count)
    : '–';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('contacts.detail.summary.rowLabel', { label, count: countText })}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.row, disabled && styles.faded]}
    >
      <Icon name={icon} size={22} color="primary" />
      <Text style={styles.label}>{label}</Text>
      <Text muted>{countText}</Text>
      <Icon name="chevron-forward" size={18} color="textMuted" />
    </Pressable>
  );
}

/**
 * How much is logged against the contact — notes, tasks and meetings — each a row that opens the full list (WD-CON-007: the
 * detail page's Activities summary). Reading notes and meetings takes the same permission as reading the contact; tasks take
 * their own, so that row is offered faded when the person may not open it, the same as the shortcut above does.
 */
export function ActivitySummary({ contactId }: { contactId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const session = useSession();
  const canReadContact = can(session.data, 'record.contacts.read');
  const canReadTasks = can(session.data, 'record.tasks.read');

  const notes = useContactNotes(contactId, canReadContact);
  const meetings = useContactMeetings(contactId, canReadContact);
  const tasks = useQuery({
    queryKey: ['contacts', 'task-summary', contactId],
    queryFn: ({ signal }) => listContactTasksForSummary(contactId, TASK_COUNT_LIMIT, signal),
    enabled: canReadTasks && contactId !== '',
  });

  return (
    <Card>
      <Text variant="subheading">{t('contacts.detail.summary.title')}</Text>
      <View style={styles.list}>
        <SummaryRow
          icon="document-text-outline"
          label={t('contacts.detail.summary.notes')}
          info={countOf(notes.data?.pages[0])}
          onPress={() => router.push({ pathname: '/contact-notes', params: { contactId } })}
        />
        <SummaryRow
          icon="checkbox-outline"
          label={t('contacts.detail.summary.tasks')}
          info={countOf(tasks.data)}
          disabled={!canReadTasks}
          onPress={() => router.push({ pathname: '/tasks', params: { contactId } })}
        />
        <SummaryRow
          icon="calendar-outline"
          label={t('contacts.detail.summary.meetings')}
          info={countOf(meetings.data?.pages[0])}
          onPress={() => router.push({ pathname: '/contact-meetings', params: { contactId } })}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  label: { flex: 1 },
  faded: { opacity: 0.4 },
});
