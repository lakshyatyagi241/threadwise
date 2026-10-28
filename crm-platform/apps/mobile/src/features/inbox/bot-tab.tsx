import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

type Props =
  | {
      /**
       * The bot has the conversation: the Bot label says who answers. For a person who may assign, pressing it opens Change agent, to give
       * the conversation to a person (as in the Geta app); without `onOpen` there is nothing to press.
       */
      mode: 'answering';
      onOpen?: () => void;
    }
  | {
      /**
       * A person has the conversation, or it waits for one: the cell names who (a headset and the agent's name, as in the Geta app) and,
       * for a person who may assign, opens Change agent. Without `onOpen` it only says who.
       */
      mode: 'person';
      name: string;
      busy: boolean;
      onOpen?: () => void;
    };

/**
 * The second cell under the thread header, next to "Assign tags". It says who is answering this conversation: "Bot", or the agent's
 * name, which opens Change agent. Nothing is drawn for a conversation no bot ever handled and nobody holds.
 */
export function BotTab(props: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const frame = [styles.cell, { borderStartColor: colors.border }];
  if (props.mode === 'answering') {
    const body = (
      <>
        <Icon
          name="hardware-chip-outline"
          size={20}
          color={props.onOpen ? 'primary' : 'textMuted'}
        />
        <Text
          variant="label"
          color={props.onOpen ? 'text' : 'textMuted'}
          numberOfLines={1}
          style={styles.text}
        >
          {t('inbox.thread.bot.tab')}
        </Text>
      </>
    );
    return props.onOpen ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('inbox.thread.bot.answering')}
        onPress={props.onOpen}
        style={frame}
      >
        {body}
      </Pressable>
    ) : (
      <View accessible accessibilityLabel={t('inbox.thread.bot.answering')} style={frame}>
        {body}
      </View>
    );
  }
  const body = (
    <>
      {props.busy ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Icon name="headset-outline" size={20} color="primary" />
      )}
      <Text variant="label" numberOfLines={1} style={styles.text}>
        {props.name}
      </Text>
    </>
  );
  if (!props.onOpen) {
    return (
      <View accessible accessibilityLabel={props.name} style={frame}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.name}
      accessibilityState={{ disabled: props.busy, busy: props.busy }}
      disabled={props.busy}
      onPress={props.onOpen}
      style={frame}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderStartWidth: StyleSheet.hairlineWidth,
  },
  text: { flexShrink: 1 },
});
