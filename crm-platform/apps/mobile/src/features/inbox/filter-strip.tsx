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
  /** The names of the chosen channels (the filter holds only their ids). */
  channelNames: readonly string[];
  /** The names of the chosen labels, in the order chosen. */
  labelNames: readonly string[];
  /** The names of the chosen agents, in the order chosen. */
  agentNames: readonly string[];
  onClearStatus: () => void;
  onClearAssignment: () => void;
  onClearSearch: () => void;
  onClearChannel: () => void;
  onClearLabels: () => void;
  onClearAgents: () => void;
  onClearSort: () => void;
  onClearDates: () => void;
  onClearArchived: () => void;
  onClearAll: () => void;
}

/** What is narrowing the list right now, each with a way to take it off, and one button for all of them. */
export function FilterStrip({
  filters,
  channelNames,
  labelNames,
  agentNames,
  onClearStatus,
  onClearAssignment,
  onClearSearch,
  onClearChannel,
  onClearLabels,
  onClearAgents,
  onClearSort,
  onClearDates,
  onClearArchived,
  onClearAll,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const chips: { key: string; text: string; onRemove: () => void }[] = [];
  if (filters.statuses.length > 0) {
    chips.push({
      key: 'status',
      text: t('inbox.filter.statusChip', {
        name: filters.statuses.map((s) => t(`inbox.statusFilter.${s}`)).join(', '),
      }),
      onRemove: onClearStatus,
    });
  }
  if (filters.assignment) {
    chips.push({
      key: 'assignment',
      text: t('inbox.filter.assignmentChip', {
        name: t(`inbox.filter.conversation_${filters.assignment}`),
      }),
      onRemove: onClearAssignment,
    });
  }
  if (filters.archived) {
    chips.push({
      key: 'archived',
      text: t('inbox.filter.archivedChip'),
      onRemove: onClearArchived,
    });
  }
  if (filters.channelIds.length > 0) {
    chips.push({
      key: 'channel',
      text: t('inbox.filter.channelChip', {
        name: channelNames.length > 0 ? channelNames.join(', ') : String(filters.channelIds.length),
      }),
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
  if (filters.agentIds.length > 0) {
    chips.push({
      key: 'agents',
      text: t('inbox.filter.agentChip', {
        // The names that are known, and how many more are on (an agent can have left the list since they were chosen).
        names:
          agentNames.length === 0
            ? String(filters.agentIds.length)
            : agentNames.length < filters.agentIds.length
              ? `${agentNames.join(', ')} +${filters.agentIds.length - agentNames.length}`
              : agentNames.join(', '),
      }),
      onRemove: onClearAgents,
    });
  }
  if (filters.sort !== 'recent') {
    chips.push({
      key: 'sort',
      text: t('inbox.filter.sortChip', { name: t(`inbox.filter.sort_${filters.sort}`) }),
      onRemove: onClearSort,
    });
  }
  if (filters.from || filters.to) {
    chips.push({
      key: 'dates',
      text: t('inbox.filter.datesChip', { range: `${filters.from || '…'} – ${filters.to || '…'}` }),
      onRemove: onClearDates,
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
