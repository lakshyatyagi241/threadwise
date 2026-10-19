import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';

interface Props {
  /** `Link for Riya Shah`. */
  title: string;
  body: string;
  link: string;
  email: string;
  onDismiss: () => void;
}

/**
 * The one-time link for a member when the server could not send the mail: shown once so it can be passed on by hand. It works once; the
 * share sheet is the person's own choice of where it goes (there is no clipboard library). It is never logged or stored.
 */
export function LinkBanner({ title, body, link, email, onDismiss }: Props) {
  const { t } = useTranslation();
  return (
    <Card>
      <Text variant="heading">{title}</Text>
      <Text muted>{body}</Text>
      <View style={styles.field}>
        <Text variant="caption" muted>
          {t('settings.members.linkEmail')}
        </Text>
        <Text selectable>{email}</Text>
      </View>
      <View style={styles.field}>
        <Text variant="caption" muted>
          {t('settings.members.linkLabel')}
        </Text>
        <Text selectable testID="member-link">
          {link}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button
          label={t('settings.members.shareLink')}
          testID="member-link-share"
          onPress={() => void Share.share({ message: link }).catch(() => undefined)}
        />
        <Button variant="link" label={t('settings.members.dismiss')} onPress={onDismiss} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  actions: { gap: spacing.sm },
});
