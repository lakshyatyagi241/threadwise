import type { DealStageRef } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Pressable } from 'react-native';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { StageDot } from './deal-parts';

interface Props {
  visible: boolean;
  dealTitle: string;
  stages: readonly DealStageRef[];
  /** The stage the deal is in now: ticked, and pressing it changes nothing. */
  currentId: string | undefined;
  onPick: (stage: DealStageRef) => void;
  onClose: () => void;
}

/** "Move to": the pipeline's stages in order, with the deal's own ticked. The phone's way to do what dragging a card does on the web. */
export function StageSheet({ visible, dealTitle, stages, currentId, onPick, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.scrim, { backgroundColor: colors.scrim }]}>
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="heading" accessibilityRole="header">
            {t('deals.move.title')}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {dealTitle}
          </Text>
          <ScrollView contentContainerStyle={styles.list} accessibilityRole="radiogroup">
            {stages.map((stage) => {
              const selected = stage.id === currentId;
              return (
                <Pressable
                  key={stage.id}
                  accessibilityRole="radio"
                  accessibilityLabel={stage.name}
                  accessibilityState={{ checked: selected }}
                  onPress={() => (selected ? onClose() : onPick(stage))}
                  style={styles.option}
                >
                  <StageDot color={stage.color} />
                  <Text variant={selected ? 'label' : 'body'} numberOfLines={1} style={styles.name}>
                    {stage.name}
                  </Text>
                  {selected ? <Icon name="checkmark" size={20} color="primary" /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <Button variant="link" label={t('deals.cancel')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '80%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  list: { gap: spacing.xs },
  option: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  name: { flex: 1 },
});
