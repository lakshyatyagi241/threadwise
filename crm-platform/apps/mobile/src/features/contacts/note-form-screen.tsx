import { createContactNoteSchema, updateContactNoteSchema } from '@crm/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderIconButton } from '@/components/ui/screen-header';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ErrorCard } from './record-parts';
import { failureKindOf, firstParam } from './record-support';
import { useContactNote, useCreateNote, useUpdateNote } from './use-notes';

/**
 * The longest note the form accepts. The API takes up to 10,000 characters; the reference product limits a note to 400, and a
 * note is kept to the same length here so a note written on either side fits on both.
 */
export const NOTE_MAX_LENGTH = 400;

interface Notice {
  tone: 'danger' | 'warning';
  message: string;
}

/**
 * Write or change a note (/contact-note?contactId=…, plus &noteId=… to change one). The check button in the header saves. A save
 * made on a stale copy is refused by the API (ROW_VERSION_CONFLICT): the screen reloads the note, shows the other person's text
 * and asks the person to look again before saving. Changing notes needs `record.contacts.update`.
 */
export function ContactNoteFormScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    contactId?: string | string[];
    noteId?: string | string[];
  }>();
  const contactId = firstParam(params.contactId);
  const noteId = firstParam(params.noteId);
  const editing = noteId !== '';
  const session = useSession();
  const allowed =
    can(session.data, 'record.contacts.read') && can(session.data, 'record.contacts.update');
  const found = useContactNote(contactId, noteId, editing && allowed);
  const create = useCreateNote(contactId);
  const update = useUpdateNote(contactId, noteId);
  const [draft, setDraft] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const note = found.note;
  const value = draft ?? note?.body ?? '';
  const pending = create.isPending || update.isPending;

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/contact-notes', params: { contactId } });
  };

  const failed = (error: unknown) => {
    if (isApiError(error) && error.isRowVersionConflict) {
      // Show the other person's text, not the stale copy, and ask for another look.
      setNotice({ tone: 'warning', message: t('contactNotes.form.conflict') });
      setDraft(null);
      void found.refetch();
    } else if (failureKindOf(error) === 'missing') {
      setNotice({ tone: 'danger', message: t('contactNotes.form.missing') });
      void found.refetch();
    } else if (isApiError(error) && error.fieldErrors.some((e) => e.path === 'body')) {
      setFieldError(t('contactNotes.form.invalid'));
    } else {
      setNotice({ tone: 'danger', message: messageForError(error, t) });
    }
  };

  const save = () => {
    if (pending) return;
    setNotice(null);
    const body = value.trim();
    if (body === '') {
      setFieldError(t('contactNotes.form.required'));
      return;
    }
    if (!editing) {
      const parsed = createContactNoteSchema.safeParse({ body });
      if (!parsed.success || body.length > NOTE_MAX_LENGTH) {
        setFieldError(t('contactNotes.form.invalid'));
        return;
      }
      setFieldError(null);
      create.mutate(parsed.data, { onSuccess: close, onError: failed });
      return;
    }
    if (!note) return;
    if (body === note.body.trim()) {
      close();
      return;
    }
    const parsed = updateContactNoteSchema.safeParse({ body, rowVersion: note.rowVersion });
    if (!parsed.success || body.length > NOTE_MAX_LENGTH) {
      setFieldError(t('contactNotes.form.invalid'));
      return;
    }
    setFieldError(null);
    update.mutate(parsed.data, { onSuccess: close, onError: failed });
  };

  const loading = (
    <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />
  );
  let showForm = false;
  let body;
  if (session.data === undefined) {
    body = loading;
  } else if (!allowed) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={t('contactNotes.denied.updateTitle')}
        hint={t('contactNotes.denied.updateHint')}
      />
    );
  } else if (contactId === '') {
    body = <EmptyState icon="people-outline" title={t('contactNotes.contactMissing')} />;
  } else if (editing && !note) {
    const kind = failureKindOf(found.error);
    if (found.searching) {
      body = loading;
    } else if (kind === 'missing') {
      body = <EmptyState icon="people-outline" title={t('contactNotes.contactMissing')} />;
    } else if (kind === 'denied') {
      body = (
        <EmptyState
          icon="lock-closed-outline"
          title={t('contactNotes.denied.title')}
          hint={t('contactNotes.denied.hint')}
        />
      );
    } else if (found.error) {
      body = (
        <View style={styles.content}>
          <ErrorCard error={found.error} onRetry={() => void found.refetch()} />
        </View>
      );
    } else {
      body = <EmptyState icon="document-text-outline" title={t('contactNotes.form.missing')} />;
    }
  } else {
    showForm = true;
    body = (
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {notice ? <Banner tone={notice.tone} message={notice.message} /> : null}
          <View style={styles.field}>
            <TextField
              label={t('contactNotes.form.label')}
              placeholder={t('contactNotes.form.placeholder')}
              value={value}
              onChangeText={(text) => {
                setDraft(text);
                setFieldError(null);
              }}
              error={fieldError}
              multiline
              numberOfLines={10}
              textAlignVertical="top"
              maxLength={NOTE_MAX_LENGTH}
              autoFocus={!editing}
            />
            <Text
              variant="caption"
              muted
              style={styles.counter}
              accessibilityLabel={t('contactNotes.form.counterLabel', {
                used: value.length,
                max: NOTE_MAX_LENGTH,
              })}
            >
              {`${value.length}/${NOTE_MAX_LENGTH}`}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={editing ? t('contactNotes.form.editTitle') : t('contactNotes.form.addTitle')}
        onBack={close}
        actions={
          !showForm ? null : pending ? (
            <View
              accessible
              accessibilityLabel={t('contactNotes.form.saving')}
              accessibilityState={{ busy: true }}
              style={styles.saving}
            >
              <ActivityIndicator />
            </View>
          ) : (
            <HeaderIconButton icon="checkmark" label={t('contactNotes.form.save')} onPress={save} />
          )
        }
      />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  loading: { marginTop: spacing.xxl },
  field: { gap: spacing.xs },
  counter: { alignSelf: 'flex-end' },
  saving: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
