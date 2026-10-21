import type { MessageMedia } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { FileTile } from './message-parts';
import { useOpenFile } from './use-open-file';

interface Props {
  media: MessageMedia;
  icon: IconName;
  label: string;
  detail: string;
}

/** A file of a message (document, video, recording) as a tile that opens it when pressed, with a spinner while it downloads and a line if that did not work. */
export function OpenFileTile({ media, icon, label, detail }: Props) {
  const { t } = useTranslation();
  const { state, open } = useOpenFile(media);
  const working = state === 'working';
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('inbox.file.open', { name: label })}
        accessibilityState={{ busy: working }}
        onPress={() => void open()}
        style={styles.press}
      >
        <FileTile icon={icon} label={label} detail={working ? t('inbox.file.opening') : detail} />
        {working ? (
          <ActivityIndicator accessibilityLabel={t('inbox.file.opening')} style={styles.spinner} />
        ) : null}
      </Pressable>
      {state === 'failed' || state === 'noApp' ? (
        <Text variant="caption" danger accessibilityRole="alert" style={styles.problem}>
          {t(state === 'failed' ? 'inbox.file.failed' : 'inbox.file.noApp')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  press: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  spinner: { position: 'absolute', right: spacing.md },
  problem: { paddingTop: spacing.xs },
});
