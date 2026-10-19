import type { LeadEventResponse } from '@crm/contracts';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { formatMoment } from '@/lib/format/dates';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { EVENT_STATUS_TONE, reasonView } from './lead-model';

interface Props {
  event: LeadEventResponse;
  onOpen: (event: LeadEventResponse) => void;
}

/** One lead a source received: what became of it (a status), why when it waits, and when it came. The row opens its details. */
function LeadEventRowBase({ event, onOpen }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const reason = reasonView(event.reason);
  const reasonText = reason
    ? reason.known
      ? t(`leads.reasons.${reason.code}`)
      : reason.raw
    : null;
  const when = formatMoment(event.receivedAt, i18n.language);
  const status = t(`leads.eventStatus.${event.status}`);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[status, reasonText, event.isTest ? t('leads.events.test') : null, when]
        .filter(Boolean)
        .join('. ')}
      onPress={() => onOpen(event)}
      style={[styles.row, { borderBottomColor: colors.border }]}
    >
      <View style={styles.body}>
        <View style={styles.badges}>
          <Badge label={status} tone={EVENT_STATUS_TONE[event.status]} />
          {event.isTest ? <Badge label={t('leads.events.test')} tone="info" /> : null}
        </View>
        {reasonText ? (
          <Text variant="body" numberOfLines={2}>
            {reasonText}
          </Text>
        ) : null}
        <Text variant="caption" muted numberOfLines={1}>
          {when}
        </Text>
      </View>
      <Icon name="chevron-forward" size={20} color="textMuted" />
    </Pressable>
  );
}

export const LeadEventRow = memo(LeadEventRowBase);

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TOUCH_TARGET + spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, gap: spacing.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
