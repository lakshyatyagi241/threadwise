import type { ContactResponse } from '@crm/contracts';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ContactActions } from './contact-actions';
import { contactLine, displayName } from './contact-display';
import { SwipeRow, type RowCloser } from './swipe-row';
import { useContactActions } from './use-contact-actions';

interface Props {
  contact: ContactResponse;
  onPress: (id: string) => void;
  /** Opens the shortcuts for this contact (the three dots). */
  onMore: (contact: ContactResponse) => void;
  /** Edit and Delete behind the row (slide it to the right). Pass one only when the person may do it. */
  onEdit?: (contact: ContactResponse) => void;
  onDelete?: (contact: ContactResponse) => void;
  /** The row started to open: the list closes the one that was open. */
  onSwipeOpen?: (row: RowCloser) => void;
}

/** The shortcuts that sit beside the name. The rest (mail, text, tasks, notes) are in the three dots and on the contact. */
const ROW_ACTIONS: readonly string[] = ['call', 'chat'];

/**
 * One contact in the list, all on one line: the avatar, the name with the phone or email (and the first tag) under it, the two
 * shortcuts (call, chat) and the three dots. The name opens the contact. When chat finds no thread, or fails, the sentence shows
 * right under the row.
 */
function ContactRowBase({ contact, onPress, onMore, onEdit, onDelete, onSwipeOpen }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [notice, setNotice] = useState<string | null>(null);
  const actions = useContactActions(contact, setNotice).filter((a) => ROW_ACTIONS.includes(a.key));
  const name = displayName(contact, t);
  const line = contactLine(contact);
  const tag = contact.tags?.[0]?.name;
  const caption = [line, tag].filter(Boolean).join(' · ');
  // A screen reader cannot slide a row, so the same two things are offered as its custom actions.
  const readerActions = [
    ...(onEdit ? [{ name: 'edit', label: t('contacts.row.swipeEdit') }] : []),
    ...(onDelete ? [{ name: 'delete', label: t('contacts.row.swipeDelete') }] : []),
  ];
  return (
    <SwipeRow
      onEdit={onEdit ? () => onEdit(contact) : undefined}
      onDelete={onDelete ? () => onDelete(contact) : undefined}
      onOpen={onSwipeOpen}
    >
      <View style={{ backgroundColor: colors.background }}>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={name}
            accessibilityHint={caption || undefined}
            accessibilityActions={readerActions.length > 0 ? readerActions : undefined}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'edit') onEdit?.(contact);
              if (event.nativeEvent.actionName === 'delete') onDelete?.(contact);
            }}
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
              {caption ? (
                <Text variant="caption" muted numberOfLines={1}>
                  {caption}
                </Text>
              ) : null}
            </View>
          </Pressable>
          <ContactActions
            compact
            actions={actions}
            describe={(label) => t('contacts.row.actionFor', { action: label, name })}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('contacts.row.more', { name })}
            onPress={() => onMore(contact)}
            style={styles.more}
          >
            <Icon name="ellipsis-vertical" size={20} color="textMuted" />
          </Pressable>
        </View>
        {notice ? (
          <Text variant="caption" color="warning" accessibilityRole="alert" style={styles.notice}>
            {notice}
          </Text>
        ) : null}
      </View>
    </SwipeRow>
  );
}

export const ContactRow = memo(ContactRowBase);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  main: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET + spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingLeft: 12,
  },
  text: { flex: 1 },
  name: { fontWeight: '600' },
  more: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
});
