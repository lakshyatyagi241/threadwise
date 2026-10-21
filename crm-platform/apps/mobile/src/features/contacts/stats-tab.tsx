import type { ContactMessageStats } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { ErrorCard } from './record-parts';
import { useContactMessageStats } from './use-message-stats';

/** The tiles, in the order the Geta app shows them (sent, delivered, replied, seen), then the two the API also counts. */
const TILES = [
  'sent',
  'delivered',
  'replied',
  'seen',
  'received',
  'failed',
] as const satisfies readonly (keyof ContactMessageStats)[];

function Tile({ label, value, locale }: { label: string; value: number; locale: string }) {
  const text = value.toLocaleString(locale);
  return (
    <Card>
      <View accessible accessibilityLabel={`${label}: ${text}`} style={styles.tile}>
        <Text variant="label" muted>
          {label}
        </Text>
        <Text variant="heading">{text}</Text>
      </View>
    </Card>
  );
}

/**
 * The contact's "Stats" tab: the WhatsApp summary (messages sent, delivered, replied to, seen, received and failed). The numbers are
 * the API's own count over the contact's WhatsApp conversations, so the app adds nothing up itself. A failed read shows a retry.
 */
export function StatsTab({ contactId }: { contactId: string }) {
  const { t, i18n } = useTranslation();
  const stats = useContactMessageStats(contactId);

  if (stats.isPending) {
    return <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  }
  if (stats.isError) {
    return <ErrorCard error={stats.error} onRetry={() => void stats.refetch()} />;
  }
  return (
    <View style={styles.root}>
      <Text variant="subheading" accessibilityRole="header">
        {t('contacts.detail.stats.title')}
      </Text>
      <View style={styles.grid}>
        {TILES.map((key) => (
          <View key={key} style={styles.cell}>
            <Tile
              label={t(`contacts.detail.stats.${key}`)}
              value={stats.data[key]}
              locale={i18n.language}
            />
          </View>
        ))}
      </View>
      <Text variant="caption" muted>
        {t('contacts.detail.stats.footnote')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  loading: { marginVertical: spacing.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  cell: { flexBasis: '47%', flexGrow: 1 },
  tile: { gap: spacing.xs },
});
