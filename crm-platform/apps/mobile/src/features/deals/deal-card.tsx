import type { DealResponse } from '@crm/contracts';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { dueState, formatDay } from './deal-format';
import { StageLabel, StatusBadge } from './deal-parts';
import { formatMoney } from './money';

interface Props {
  deal: DealResponse;
  /** The list view mixes every stage, so each row names its own; a board column is one stage and does not repeat it. */
  showStage: boolean;
  /** The person may change or delete: only then is there an overflow button. */
  canMore: boolean;
  /** This deal's request is in flight. */
  busy: boolean;
  onOpen: (id: string) => void;
  onMore: (deal: DealResponse) => void;
}

/**
 * One deal in a column or the list: its name, the customer, the value, the expected close date (red when past, amber today), who
 * owns it and, once closed, Won or Lost. The card opens the deal; the three dots open the actions (move, won, lost, edit, delete).
 */
function DealCardBase({ deal, showStage, canMore, busy, onOpen, onMore }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const customer = deal.contact?.name || deal.contact?.phone || t('deals.card.noContact');
  const state = deal.status === 'open' ? dueState(deal.expectedCloseDate) : null;
  const money = formatMoney(deal.value, deal.currency, i18n.language);
  const close = deal.expectedCloseDate ? formatDay(deal.expectedCloseDate, i18n.language) : '';
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor:
            deal.status === 'won'
              ? colors.success
              : deal.status === 'lost'
                ? colors.danger
                : colors.border,
          opacity: busy ? 0.5 : 1,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={deal.title}
        accessibilityHint={`${money}, ${customer}`}
        accessibilityState={{ busy }}
        onPress={() => onOpen(deal.id)}
        style={styles.body}
      >
        <View style={styles.top}>
          <Text variant="subheading" numberOfLines={2} style={styles.title}>
            {deal.title}
          </Text>
        </View>
        <Text variant="caption" muted numberOfLines={1}>
          {customer}
          {deal.company ? ` · ${deal.company.name}` : ''}
        </Text>
        <View style={styles.money}>
          <Text variant="label">{money}</Text>
          {deal.status !== 'open' ? <StatusBadge status={deal.status} /> : null}
          {state && close ? (
            <Badge
              tone={state === 'overdue' ? 'danger' : state === 'today' ? 'warning' : 'neutral'}
              label={t(`deals.card.due.${state}`, { when: close })}
            />
          ) : null}
        </View>
        <View style={styles.foot}>
          {showStage ? <StageLabel name={deal.stage.name} color={deal.stage.color} /> : null}
          <View style={styles.owner}>
            <Avatar name={deal.owner?.name} size={22} />
            <Text variant="caption" muted numberOfLines={1} style={styles.ownerName}>
              {deal.owner?.name ?? t('deals.unassigned')}
            </Text>
          </View>
        </View>
      </Pressable>
      {canMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('deals.card.more', { title: deal.title })}
          onPress={() => onMore(deal)}
          style={styles.more}
        >
          <Icon name="ellipsis-vertical" size={20} color="textMuted" />
        </Pressable>
      ) : null}
    </View>
  );
}

export const DealCard = memo(DealCardBase);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  body: { flex: 1, minHeight: MIN_TOUCH_TARGET, gap: spacing.xs, padding: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1 },
  money: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  foot: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  owner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  ownerName: { flexShrink: 1 },
  more: {
    width: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
