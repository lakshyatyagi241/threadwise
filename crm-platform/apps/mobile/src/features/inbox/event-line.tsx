import type { ConversationEvent } from '@crm/contracts';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { eventLabel } from './details-timeline';

/** What the thread knows about people, to put a name to an id in an event (which carries ids only). */
export interface PeopleNames {
  /** The signed-in person: "Assigned to you". */
  meId: string;
  /** Names by user id: the current assignee and the people who did the events. */
  names: ReadonlyMap<string, string>;
}

const stringOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * The words of an assignment line, as the Geta app draws it between the messages: who the conversation went to. An id the thread has no
 * name for (a third person, assigned by someone else) leaves just the event's own word ("Assigned").
 */
export function assignmentLineText(
  event: ConversationEvent,
  people: PeopleNames,
  t: TFunction,
): string {
  const to = stringOf(event.payload['toUserId']);
  if (event.type === 'unassigned' || (to === null && event.type !== 'assigned')) {
    return t('inbox.event.unassigned');
  }
  if (to === null) return eventLabel(event.type, t);
  if (to === people.meId) return t('inbox.thread.assignment.you');
  const name = people.names.get(to);
  return name ? t('inbox.thread.assignment.to', { name }) : eventLabel(event.type, t);
}

/** An assignment event in the thread: a thin line, an info mark and the words, centred. It is for the team only. */
export function EventLine({ event, people }: { event: ConversationEvent; people: PeopleNames }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const text = assignmentLineText(event, people, t);
  return (
    <View
      testID={`thread-event-${event.id}`}
      accessible
      accessibilityLabel={text}
      style={styles.row}
    >
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
      <Icon name="information-circle-outline" size={16} color="textMuted" />
      <Text variant="caption" muted numberOfLines={2} style={styles.text}>
        {text}
      </Text>
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  text: { flexShrink: 1, textAlign: 'center' },
});
