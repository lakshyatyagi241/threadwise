import type { LeadEventResponse } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { formatMoment } from '@/lib/format/dates';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { EVENT_STATUS_TONE, guidanceFor, isRetryable, reasonView } from './lead-model';

interface Props {
  /** The lead whose details are shown; the sheet is closed when there is none. */
  event: LeadEventResponse | null;
  /** Retrying needs the permission to manage lead sources. */
  canRetry: boolean;
  /** Opening the contact or the deal it became needs the permission to read that record. */
  canOpenContact: boolean;
  canOpenDeal: boolean;
  retrying: boolean;
  /** A refused retry, in words. */
  notice: string | null;
  onRetry: (event: LeadEventResponse) => void;
  onOpenContact: (id: string) => void;
  onOpenDeal: (id: string) => void;
  onClose: () => void;
}

/**
 * One lead in a sheet from the bottom: what became of it, why, what to do about it, and the buttons that follow (retry, open the
 * contact or the deal it became). The raw payload is personal data and is not shown in the app.
 */
export function LeadEventSheet({
  event,
  canRetry,
  canOpenContact,
  canOpenDeal,
  retrying,
  notice,
  onRetry,
  onOpenContact,
  onOpenDeal,
  onClose,
}: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const reason = event ? reasonView(event.reason) : null;
  const guidance = event ? guidanceFor(event.status, event.reason) : null;
  return (
    <Modal transparent visible={event !== null} animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('leads.event.close')}
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={onClose}
      >
        <Pressable
          accessibilityViewIsModal
          onPress={() => undefined}
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          {event ? (
            <ScrollView contentContainerStyle={styles.content}>
              <Text variant="heading" accessibilityRole="header">
                {t('leads.event.title')}
              </Text>
              <View style={styles.badges}>
                <Badge
                  label={t(`leads.eventStatus.${event.status}`)}
                  tone={EVENT_STATUS_TONE[event.status]}
                />
                {event.isTest ? <Badge label={t('leads.events.test')} tone="info" /> : null}
              </View>
              {notice ? <Banner tone="warning" message={notice} /> : null}
              {reason ? (
                <Field
                  label={t('leads.event.reason')}
                  value={reason.known ? t(`leads.reasons.${reason.code}`) : reason.raw}
                />
              ) : null}
              {guidance ? <Text muted>{t(`leads.guidance.${guidance}`)}</Text> : null}
              <Field
                label={t('leads.event.received')}
                value={formatMoment(event.receivedAt, i18n.language)}
              />
              <Field
                label={t('leads.event.processed')}
                value={
                  event.processedAt
                    ? formatMoment(event.processedAt, i18n.language)
                    : t('leads.event.notProcessed')
                }
              />
              <Field label={t('leads.event.attempts')} value={String(event.attempts)} />
              {event.duplicateCount > 0 ? (
                <Text variant="caption" muted>
                  {t('leads.event.deliveredAgain', { count: event.duplicateCount })}
                </Text>
              ) : null}
              <View style={styles.actions}>
                {canRetry && isRetryable(event) ? (
                  <Button
                    label={t('leads.event.retry')}
                    loading={retrying}
                    onPress={() => onRetry(event)}
                  />
                ) : null}
                {event.contactId && canOpenContact ? (
                  <Button
                    variant="secondary"
                    label={t('leads.event.openContact')}
                    onPress={() => onOpenContact(event.contactId as string)}
                  />
                ) : null}
                {event.dealId && canOpenDeal ? (
                  <Button
                    variant="secondary"
                    label={t('leads.event.openDeal')}
                    onPress={() => onOpenDeal(event.dealId as string)}
                  />
                ) : null}
                <Button variant="link" label={t('leads.event.close')} onPress={onClose} />
              </View>
            </ScrollView>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text variant="body">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  content: { padding: spacing.lg, gap: spacing.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  field: { gap: spacing.xs },
  actions: { gap: spacing.sm, paddingTop: spacing.md },
});
