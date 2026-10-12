import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import type { StatusFilter } from './filters';

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
  status: StatusFilter;
  q: string;
  onClearStatus: () => void;
  onClearSearch: () => void;
  onClearAll: () => void;
}

/** What is narrowing the list right now, each with a way to take it off, and one button for all of them. */
export function FilterStrip({ status, q, onClearStatus, onClearSearch, onClearAll }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const statusText =
    status === 'default'
      ? null
      : t('inbox.filter.statusChip', { name: t(`inbox.statusFilter.${status}`) });
  const searchText = q.trim() ? t('inbox.filter.searchChip', { q: q.trim() }) : null;
  return (
    <View
      accessibilityLabel={t('inbox.filter.applied')}
      style={[styles.strip, { borderBottomColor: colors.border }]}
    >
      <View style={styles.chips}>
        {statusText ? (
          <Chip
            text={statusText}
            removeLabel={t('inbox.filter.remove', { name: statusText })}
            onRemove={onClearStatus}
          />
        ) : null}
        {searchText ? (
          <Chip
            text={searchText}
            removeLabel={t('inbox.filter.remove', { name: searchText })}
            onRemove={onClearSearch}
          />
        ) : null}
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
