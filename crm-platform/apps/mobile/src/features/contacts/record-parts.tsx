import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { CONTROL_HEIGHT, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

/** A failed read: the reason in the person's language and a way to try again. */
export function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Card>
      <Text danger accessibilityRole="alert">
        {messageForError(error, t)}
      </Text>
      <Button variant="secondary" label={t('common.retry')} onPress={onRetry} />
    </Card>
  );
}

interface ConfirmProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** The delete is on its way: the buttons stop answering so it cannot be sent twice. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks "are you sure" before something is deleted. The delete button is red, the way back is the quieter button below it. */
export function ConfirmDeleteModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const { colors } = useTheme();
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.scrim, { backgroundColor: colors.scrim }]}>
        <View
          accessibilityViewIsModal
          style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="heading" accessibilityRole="header">
            {title}
          </Text>
          <Text>{message}</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              accessibilityState={{ disabled: pending, busy: pending }}
              disabled={pending}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.danger,
                { backgroundColor: colors.danger, opacity: pending ? 0.5 : pressed ? 0.85 : 1 },
              ]}
            >
              {pending ? (
                <ActivityIndicator color={colors.onDanger} />
              ) : (
                <Text variant="label" color="onDanger" style={styles.dangerLabel}>
                  {confirmLabel}
                </Text>
              )}
            </Pressable>
            <Button variant="secondary" label={cancelLabel} disabled={pending} onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  dialog: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  actions: { gap: spacing.sm },
  danger: {
    minHeight: CONTROL_HEIGHT,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerLabel: { fontSize: 16, lineHeight: 22, textAlign: 'center' },
});
