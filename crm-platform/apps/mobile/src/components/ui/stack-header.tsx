import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';

interface Props {
  title: string;
  onBack: () => void;
  actions?: ReactNode;
}

/** The top bar of a screen opened from the list: a back button, the title, and optional icon buttons on the right. */
export function StackHeader({ title, onBack, actions }: Props) {
  const { t } = useTranslation();
  return (
    <ScreenHeader actions={actions}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          style={styles.back}
        >
          <Icon name="chevron-back" size={24} />
        </Pressable>
        <Text variant="heading" accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      </View>
    </ScreenHeader>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginLeft: -spacing.md },
  back: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1 },
});
