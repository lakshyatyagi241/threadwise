import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { RectButton } from 'react-native-gesture-handler';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

/** What a list needs from a row to keep one row open at a time. */
export interface RowCloser {
  close: () => void;
}

interface Props {
  children: ReactNode;
  /** Present only when the person may edit; without it the Edit button is not shown. */
  onEdit?: () => void;
  /** Present only when the person may delete; without it the Delete button is not shown. */
  onDelete?: () => void;
  /** Called as the row starts to open, so the list can close the one that was open. */
  onOpen?: (row: RowCloser) => void;
}

/** One button's width: wide enough for a thumb and for the longest word in the three languages. */
const ACTION_WIDTH = 84;

/**
 * A list row that slides to the right and shows Edit (blue) and Delete (red) behind it, like the CRM's other mobile screens. It
 * only moves with a finger; its buttons are the gesture library's own (a plain Pressable did not get the taps inside a swiped row on Android); the three dots on the row and the screen reader's actions do the same things for everyone else. A
 * button closes the row and then does its work, so the row is never left open under the confirmation. Edit and Delete are drawn only
 * when the person has the permission for them; with neither, the row is drawn plain.
 */
export function SwipeRow({ children, onEdit, onDelete, onOpen }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const ref = useRef<SwipeableMethods | null>(null);
  if (!onEdit && !onDelete) return <>{children}</>;

  const act = (run: () => void) => () => {
    ref.current?.close();
    run();
  };

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      overshootLeft={false}
      overshootRight={false}
      leftThreshold={ACTION_WIDTH / 2}
      onSwipeableWillOpen={() => {
        if (ref.current) onOpen?.(ref.current);
      }}
      renderLeftActions={() => (
        // Behind the row for a finger only: a screen reader gets the same two things as actions on the row itself.
        <View
          style={styles.actions}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {onEdit ? (
            <RectButton
              accessibilityRole="button"
              accessibilityLabel={t('contacts.row.swipeEdit')}
              onPress={act(onEdit)}
              style={[styles.action, { backgroundColor: colors.primary }]}
            >
              <View style={styles.body}>
                <Icon name="create-outline" size={22} color="onPrimary" />
                <Text variant="caption" color="onPrimary">
                  {t('contacts.row.swipeEdit')}
                </Text>
              </View>
            </RectButton>
          ) : null}
          {onDelete ? (
            <RectButton
              accessibilityRole="button"
              accessibilityLabel={t('contacts.row.swipeDelete')}
              onPress={act(onDelete)}
              style={[styles.action, { backgroundColor: colors.danger }]}
            >
              <View style={styles.body}>
                <Icon name="trash-outline" size={22} color="onDanger" />
                <Text variant="caption" color="onDanger">
                  {t('contacts.row.swipeDelete')}
                </Text>
              </View>
            </RectButton>
          ) : null}
        </View>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row' },
  action: {
    width: ACTION_WIDTH,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { alignItems: 'center', gap: 4 },
});
