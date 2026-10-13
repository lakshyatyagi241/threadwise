import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import type { InboxFilters } from './filters';

interface ChipProps {
  text: string;
  removeLabel: string;
  onRemove: () => void;
}

function Chip({ text, removeLabel, onRemove }: ChipProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={removeLabel}
      onPress={onRemove}
      style={styles.chipHit}
    >
      <View style={[styles.chip, { backgroundColor: colors.primarySoft }]}>
        <Text variant="caption" color="primary" numberOfLines={1} style={styles.chipText}>
          {text}
        </Text>
        <Icon name="close" size={14} color="primary" />
      </View>
    </Pressable>
  );
}

interface Props {
  filters: InboxFilters;
  /** The channel's name, when a channel is chosen (the filter holds only its id). */
  channelName: string | null;
  /** The names of the chosen labels, in the order chosen. */
  labelNames: readonly string[];
  onClearStatus: () => void;
  onClearSearch: () => void;
  onClearChannel: () => void;
  onClearLabels: () => void;
  onClearArchived: () => void;
  onClearAll: () => void;
}

/** What is narrowing the list right now, each with a way to take it off, and one button for all of them. */
export function FilterStrip({
  filters,
  channelName,
  labelNames,
  onClearStatus,
  onClearSearch,
  onClearChannel,
  onClearLabels,
  onClearArchived,
  onClearAll,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const chips: { key: string; text: string; onRemove: () => void }[] = [];
  if (filters.status !== 'default') {
    chips.push({
      key: 'status',
      text: t('inbox.filter.statusChip', { name: t(`inbox.statusFilter.${filters.status}`) }),
      onRemove: onClearStatus,
    });
  }
  if (filters.archived) {
    chips.push({
      key: 'archived',
      text: t('inbox.filter.archivedChip'),
      onRemove: onClearArchived,
    });
  }
  if (filters.channelId) {
    chips.push({
      key: 'channel',
      text: t('inbox.filter.channelChip', { name: channelName ?? t('inbox.filter.channel') }),
      onRemove: onClearChannel,
    });
  }
  if (filters.labels.length > 0) {
    chips.push({
      key: 'labels',
      text: t('inbox.filter.labelsChip', {
        names: labelNames.length > 0 ? labelNames.join(', ') : String(filters.labels.length),
      }),
      onRemove: onClearLabels,
    });
  }
  if (filters.q.trim()) {
    chips.push({
      key: 'search',
      text: t('inbox.filter.searchChip', { q: filters.q.trim() }),
      onRemove: onClearSearch,
    });
  }
  return (
    <View
      accessibilityLabel={t('inbox.filter.applied')}
      style={[styles.strip, { borderBottomColor: colors.border }]}
    >
      <View style={styles.chips}>
        {chips.map((chip) => (
          <Chip
            key={chip.key}
            text={chip.text}
            removeLabel={t('inbox.filter.remove', { name: chip.text })}
            onRemove={chip.onRemove}
          />
        ))}
      </View>
      <Button variant="link" label={t('inbox.filter.clearAll')} onPress={onClearAll} />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chipHit: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    maxWidth: 220,
  },
  chipText: { flexShrink: 1 },
});
