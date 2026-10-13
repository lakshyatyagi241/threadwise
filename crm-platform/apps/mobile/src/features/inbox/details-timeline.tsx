import { CONVERSATION_EVENT_TYPES, type ConversationEvent } from '@crm/contracts';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Section } from './details-parts';
import { formatDateTime } from './time';
import { useEvents } from './use-notes';

const KNOWN: ReadonlySet<string> = new Set(CONVERSATION_EVENT_TYPES);

/**
 * What an event is called. The inbox writes the known ones; routing, SLA and automation write others, so the list is open: a type
 * the app has no words for is shown with its underscores turned into spaces, as the web does.
 */
export function eventLabel(type: string, t: TFunction): string {
  if (KNOWN.has(type)) return t(`inbox.event.${type as (typeof CONVERSATION_EVENT_TYPES)[number]}`);
  const words = type.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : type;
}

function Event({ event }: { event: ConversationEvent }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const actor =
    event.actor.name ?? (event.actor.kind === 'user' ? null : t('inbox.details.timeline.system'));
  return (
    <View style={[styles.event, { borderBottomColor: colors.border }]} testID={`event-${event.id}`}>
      <Text>{eventLabel(event.type, t)}</Text>
      <Text variant="caption" muted>
        {[actor, formatDateTime(event.createdAt, t)].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
}

/** The activity timeline of the conversation, newest first: who did what, and when. */
export function TimelineSection({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation();
  const events = useEvents(conversationId, true);
  const items = events.data?.data ?? [];
  return (
    <Section title={t('inbox.details.timeline.title')}>
      {events.isPending ? (
        <ActivityIndicator accessibilityLabel={t('common.loading')} />
      ) : events.error && !events.data ? (
        <View>
          <Banner tone="danger" message={messageForError(events.error, t)} />
          <Button
            variant="link"
            align="start"
            label={t('common.retry')}
            onPress={() => void events.refetch()}
          />
        </View>
      ) : items.length === 0 ? (
        <Text muted>{t('inbox.details.timeline.empty')}</Text>
      ) : (
        items.map((event) => <Event key={event.id} event={event} />)
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  event: { gap: 2, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
});
