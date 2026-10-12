import { Modal, StyleSheet, View } from 'react-native';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Button } from './button';
import { Text } from './text';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks before something that cannot be taken back: a title, one sentence, and a pair of buttons. */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  pending,
  onConfirm,
  onCancel,
}: Props) {
  const { colors } = useTheme();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.scrim, { backgroundColor: colors.scrim }]}>
        <View
          accessibilityViewIsModal
          style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="heading" accessibilityRole="header">
            {title}
          </Text>
          <Text muted>{message}</Text>
          <View style={styles.buttons}>
            <View style={styles.fill}>
              <Button label={cancelLabel} variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.fill}>
              <Button label={confirmLabel} loading={pending} onPress={onConfirm} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  dialog: {
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
});
