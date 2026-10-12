import type { ContactResponse } from '@crm/contracts';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { contactLine, displayName } from './contact-display';

interface Props {
  contact: ContactResponse;
  onPress: (id: string) => void;
  /** Opens the shortcuts for this contact (the three dots). */
  onMore: (contact: ContactResponse) => void;
}

/** One contact in the list: a coloured avatar, the name, the phone or email, and the first tag. The whole row opens the contact. */
function ContactRowBase({ contact, onPress, onMore }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const name = displayName(contact, t);
  const line = contactLine(contact);
  const tag = contact.tags?.[0];
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityHint={line ?? undefined}
        onPress={() => onPress(contact.id)}
        style={({ pressed }) => [
          styles.main,
          { backgroundColor: pressed ? colors.primarySoft : colors.background },
        ]}
      >
        <Avatar name={name} size={40} />
        <View style={styles.text}>
          <Text variant="body" numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          {line ? (
            <Text variant="caption" muted numberOfLines={1}>
              {line}
            </Text>
          ) : null}
        </View>
        {tag ? (
          <View style={[styles.tag, { backgroundColor: colors.surfaceMuted }]}>
            <Text variant="caption" muted numberOfLines={1}>
              {tag.name}
            </Text>
          </View>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('contacts.row.more', { name })}
        onPress={() => onMore(contact)}
        style={styles.more}
      >
        <Icon name="ellipsis-vertical" size={20} color="textMuted" />
      </Pressable>
    </View>
  );
}

export const ContactRow = memo(ContactRowBase);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  main: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingLeft: 12,
  },
  more: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  name: { fontWeight: '600' },
  tag: {
    maxWidth: 110,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
});
