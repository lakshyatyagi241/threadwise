import type { ConversationNote } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { formatClock } from './time';

/**
 * A private note in the thread, where it was written: a warm card across the width, so it cannot be taken for something the
 * customer sees. Staff only; it is never sent to the customer.
 */
export function NoteBubble({ note }: { note: ConversationNote }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const author = note.author.name ?? t('inbox.details.notes.unknownAuthor');
  const time = formatClock(note.createdAt, t);
  return (
    <View style={styles.row}>
      <View
        testID={`thread-note-${note.id}`}
        accessible
        accessibilityLabel={t('inbox.note.label', { name: author, text: note.body, time })}
        style={[styles.card, { backgroundColor: colors.warningSoft }]}
      >
        <View style={styles.head}>
          <Icon name="lock-closed-outline" size={14} color="warning" />
          <Text variant="caption" color="warning">
            {t('inbox.note.title')}
          </Text>
        </View>
        <Text>{note.body}</Text>
        <Text variant="caption" muted>
          {`${author} · ${time}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.md, paddingVertical: 2 },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
