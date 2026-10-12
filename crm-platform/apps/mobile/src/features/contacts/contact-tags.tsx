import type { TagResponse } from '@crm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { useAttachTag, useDetachTag } from './use-contacts';

interface Props {
  contactId: string;
  tags: readonly TagResponse[];
  /** Whether the person may add and remove tags (`record.contacts.update`). */
  editable: boolean;
}

/** The contact's tags as pills. With permission, each pill has a remove button and a field adds a tag by name. */
export function ContactTags({ contactId, tags, editable }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const attach = useAttachTag(contactId);
  const detach = useDetachTag(contactId);
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const failure = attach.error ?? detach.error;

  const add = () => {
    if (!trimmed) return;
    detach.reset();
    attach.mutate(trimmed, { onSuccess: () => setName('') });
  };

  return (
    <Card>
      <Text variant="subheading">{t('contacts.tags.title')}</Text>
      {failure ? <Banner tone="danger" message={messageForError(failure, t)} /> : null}
      {tags.length === 0 ? (
        <Text muted>{t('contacts.tags.none')}</Text>
      ) : (
        <View style={styles.pills}>
          {tags.map((tag) =>
            editable ? (
              <Pressable
                key={tag.id}
                accessibilityRole="button"
                accessibilityLabel={t('contacts.tags.remove', { name: tag.name })}
                disabled={detach.isPending}
                onPress={() => {
                  attach.reset();
                  detach.mutate(tag.id);
                }}
                style={styles.hit}
              >
                <View style={[styles.pill, { backgroundColor: colors.surfaceMuted }]}>
                  <Text variant="label">{tag.name}</Text>
                  <Icon name="close" size={16} color="textMuted" />
                </View>
              </Pressable>
            ) : (
              <View key={tag.id} style={[styles.pill, { backgroundColor: colors.surfaceMuted }]}>
                <Text variant="label">{tag.name}</Text>
              </View>
            ),
          )}
        </View>
      )}
      {editable ? (
        <View style={styles.add}>
          <TextField
            label={t('contacts.tags.addLabel')}
            placeholder={t('contacts.tags.addPlaceholder')}
            value={name}
            onChangeText={setName}
            returnKeyType="done"
            onSubmitEditing={add}
          />
          <Button
            variant="secondary"
            label={t('contacts.tags.add')}
            loading={attach.isPending}
            disabled={!trimmed}
            onPress={add}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hit: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  add: { gap: spacing.sm },
});
