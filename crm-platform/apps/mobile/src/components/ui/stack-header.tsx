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
  /** The title in the middle of the bar, as the Geta app's screens draw it, instead of next to the back button. */
  centered?: boolean;
  /** With `centered`: how many icon buttons `actions` holds, so the title stays in the middle of the screen, not of what is left. */
  actionCount?: number;
}

/** The top bar of a screen opened from the list: a back button, the title, and optional icon buttons on the right. */
export function StackHeader({ title, onBack, actions, centered, actionCount = 1 }: Props) {
  const { t } = useTranslation();
  // The title's room ends where the icons begin; reaching the room over the icons beyond the first, and keeping the words clear of them
  // on both sides, puts the middle of the words in the middle of the bar.
  const extra = Math.max(actionCount - 1, 0) * MIN_TOUCH_TARGET;
  return (
    <ScreenHeader actions={actions}>
      <View style={[styles.row, centered && { marginRight: -extra }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          style={styles.back}
        >
          <Icon name="chevron-back" size={24} />
        </Pressable>
        <Text
          variant="heading"
          accessibilityRole="header"
          numberOfLines={1}
          style={[styles.title, centered && { textAlign: 'center', paddingHorizontal: extra }]}
        >
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
