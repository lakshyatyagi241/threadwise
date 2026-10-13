import { NOTE_BODY_MAX, type ConversationNote } from '@crm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Section } from './details-parts';
import { formatDateTime } from './time';
import { useChangeNotes, useNotes } from './use-notes';

interface Props {
  conversationId: string;
  /** The signed-in person: may delete their own notes. */
  meId: string;
  /** `inbox.conversation.note`: may write notes. */
  canWrite: boolean;
  /** `inbox.conversation.assign`: may delete anyone's note, as the API allows. */
  canDeleteAny: boolean;
}

/**
 * Internal notes: what the team wrote about this conversation, newest first, and a box to add one. A note is only ever seen by
 * staff and is never sent to the customer.
 */
export function NotesSection({ conversationId, meId, canWrite, canDeleteAny }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const notes = useNotes(conversationId, true);
  const { add, remove } = useChangeNotes(conversationId);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [asking, setAsking] = useState<ConversationNote | null>(null);

  const body = draft.trim();
  const tooLong = body.length > NOTE_BODY_MAX;
  const items = notes.data?.data ?? [];

  const submit = () => {
    if (!body || tooLong) return;
    setFailed(null);
    add.mutate(body, {
      onSuccess: () => setDraft(''),
      onError: () => setFailed(t('inbox.details.notes.failed')),
    });
  };
  const confirmDelete = () => {
    if (!asking) return;
    setFailed(null);
    remove.mutate(asking.id, {
      onSuccess: () => setAsking(null),
      onError: () => {
        setAsking(null);
        setFailed(t('inbox.details.notes.deleteFailed'));
      },
    });
  };

  return (
    <Section title={t('inbox.details.notes.title')} count={items.length}>
      {failed ? <Banner tone="danger" message={failed} /> : null}
      {notes.isPending ? (
        <ActivityIndicator accessibilityLabel={t('common.loading')} />
      ) : notes.error && !notes.data ? (
        <View>
          <Banner tone="danger" message={messageForError(notes.error, t)} />
          <Button
            variant="link"
            align="start"
            label={t('common.retry')}
            onPress={() => void notes.refetch()}
          />
        </View>
      ) : items.length === 0 ? (
        <Text muted>{t('inbox.details.notes.empty')}</Text>
      ) : (
        items.map((note) => {
          const author = note.author.name ?? t('inbox.details.notes.unknownAuthor');
          const mine = note.author.userId === meId;
          return (
            <View
              key={note.id}
              style={[styles.note, { borderBottomColor: colors.border }]}
              testID={`note-${note.id}`}
            >
              <Text>{note.body}</Text>
              <View style={styles.meta}>
                <Text variant="caption" muted style={styles.author}>
                  {`${author} · ${formatDateTime(note.createdAt, t)}`}
                </Text>
                {mine || canDeleteAny ? (
                  <Button
                    variant="link"
                    label={t('inbox.details.notes.delete')}
                    accessibilityLabel={t('inbox.details.notes.deleteFor', { name: author })}
                    onPress={() => setAsking(note)}
                  />
                ) : null}
              </View>
            </View>
          );
        })
      )}
      {canWrite ? (
        <View style={styles.compose}>
          <TextField
            label={t('inbox.details.notes.label')}
            value={draft}
            onChangeText={setDraft}
            multiline
            error={tooLong ? t('inbox.details.notes.tooLong', { max: NOTE_BODY_MAX }) : null}
          />
          <Button
            label={t('inbox.details.notes.add')}
            loading={add.isPending}
            disabled={!body || tooLong}
            onPress={submit}
          />
        </View>
      ) : null}
      <ConfirmDialog
        visible={asking !== null}
        title={t('inbox.details.notes.delete')}
        message={asking?.body ?? ''}
        confirmLabel={t('inbox.details.notes.delete')}
        cancelLabel={t('inbox.sheet.close')}
        pending={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setAsking(null)}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  note: { gap: spacing.xs, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  author: { flex: 1 },
  compose: { gap: spacing.sm },
});
