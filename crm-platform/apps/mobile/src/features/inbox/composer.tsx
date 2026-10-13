import { MESSAGE_BODY_MAX } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
}

/** The box at the bottom of a thread with an open reply window. Sending is possible only for a non-empty message within the length limit. */
export function Composer({ value, onChange, onSend }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const trimmed = value.trim();
  const tooLong = trimmed.length > MESSAGE_BODY_MAX;
  const canSend = trimmed.length > 0 && !tooLong;
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom + spacing.sm,
        },
      ]}
    >
      <View style={styles.field}>
        <TextField
          label={t('inbox.composer.label')}
          placeholder={t('inbox.composer.placeholder')}
          value={value}
          onChangeText={onChange}
          multiline
          error={tooLong ? t('inbox.composer.tooLong', { max: MESSAGE_BODY_MAX }) : null}
        />
      </View>
      <Button label={t('inbox.composer.send')} onPress={onSend} disabled={!canSend} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  field: { flex: 1 },
});
