import type { ContactNoteResponse } from '@crm/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon, type IconName } from '@/components/ui/icon';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { formatMoment } from './contact-display';
import { ConfirmDeleteModal, ErrorCard } from './record-parts';
import { failureKindOf, firstParam, joinMeta } from './record-support';
import { useContactNotes, useDeleteNote } from './use-notes';

const FAB_SIZE = 52;
const FAB_MARGIN = 24;
const SKELETON_ROWS = Array.from({ length: 6 }, (_, i) => i);

/** Whether a note was changed after it was written. The API stamps both times alike when it creates the note. */
const wasEdited = (note: ContactNoteResponse) =>
  Date.parse(note.updatedAt) !== Date.parse(note.createdAt);

interface RowProps {
  note: ContactNoteResponse;
  locale: string;
  /** The person may change notes: the row opens the edit form and has a menu. */
  editable: boolean;
  onOpen: (note: ContactNoteResponse) => void;
  onMenu: (note: ContactNoteResponse) => void;
}

/**
 * One note: its text (three lines at most), when it was written and whether it was edited. The API names the author by an id
 * only, so no author is shown. With permission the row opens the edit form and its three dots open the note's menu.
 */
function NoteRowBase({ note, locale, editable, onOpen, onMenu }: RowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const date = formatMoment(note.createdAt, locale);
  const text = (
    <>
      <Text numberOfLines={3}>{note.body}</Text>
      <Text variant="caption" muted>
        {joinMeta([date, wasEdited(note) ? t('contactNotes.edited') : null])}
      </Text>
    </>
  );
  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {editable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityHint={t('contactNotes.menu.edit')}
          onPress={() => onOpen(note)}
          style={styles.main}
        >
          {text}
        </Pressable>
      ) : (
        <View accessible style={styles.main}>
          {text}
        </View>
      )}
      {editable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('contactNotes.menu.open', { date: date ?? '' })}
          onPress={() => onMenu(note)}
          style={styles.more}
        >
          <Icon name="ellipsis-vertical" size={20} color="textMuted" />
        </Pressable>
      ) : null}
    </View>
  );
}
const NoteRow = memo(NoteRowBase);

function MenuItem({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.item}
    >
      <Icon name={icon} size={22} color={danger ? 'danger' : 'text'} />
      <Text color={danger ? 'danger' : 'text'}>{label}</Text>
    </Pressable>
  );
}

/** What the three dots of a note offer, in a sheet from the bottom. */
function NoteMenu({
  onEdit,
  onDelete,
  onClose,
}: {
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.scrim, { backgroundColor: colors.scrim }]}>
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <MenuItem icon="create-outline" label={t('contactNotes.menu.edit')} onPress={onEdit} />
          <MenuItem
            icon="trash-outline"
            label={t('contactNotes.menu.delete')}
            danger
            onPress={onDelete}
          />
          <Button variant="link" label={t('contactNotes.cancel')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/** Placeholder rows while the first page loads, so the list does not jump when it arrives. */
function NotesSkeleton() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const bar = { backgroundColor: colors.surfaceMuted };
  return (
    <View
      accessible
      accessibilityLabel={t('common.loading')}
      accessibilityState={{ busy: true }}
      style={styles.skeleton}
    >
      {SKELETON_ROWS.map((i) => (
        <View
          key={i}
          testID="note-skeleton-row"
          style={[styles.row, styles.skeletonRow, { borderColor: colors.border }]}
        >
          <View style={[styles.line, styles.long, bar]} />
          <View style={[styles.line, styles.short, bar]} />
        </View>
      ))}
    </View>
  );
}

/**
 * A contact's notes (/contact-notes?contactId=…), newest first, a page of 20 at a time. People who may update contacts get the
 * round add button, the edit form behind each row and the menu with edit and delete (deleting asks first). The API has no
 * read-only note permission: reading notes needs `record.contacts.read`, changing them `record.contacts.update`.
 */
export function ContactNotesScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ contactId?: string | string[] }>();
  const contactId = firstParam(params.contactId);
  const session = useSession();
  const canRead = can(session.data, 'record.contacts.read');
  const canUpdate = can(session.data, 'record.contacts.update');
  const list = useContactNotes(contactId, canRead);
  const remove = useDeleteNote(contactId);
  const [menuFor, setMenuFor] = useState<ContactNoteResponse | null>(null);
  const [deleting, setDeleting] = useState<ContactNoteResponse | null>(null);
  const [removeError, setRemoveError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const notes = useMemo(() => list.data?.pages.flatMap((page) => page.data) ?? [], [list.data]);
  const locale = i18n.language;

  const back = () => {
    if (router.canGoBack()) router.back();
    else if (contactId) router.replace({ pathname: '/contact/[id]', params: { id: contactId } });
    else router.replace('/contacts');
  };
  const openForm = useCallback(
    (note: ContactNoteResponse) =>
      router.push({ pathname: '/contact-note', params: { contactId, noteId: note.id } }),
    [router, contactId],
  );
  const openMenu = useCallback((note: ContactNoteResponse) => setMenuFor(note), []);
  const refresh = async () => {
    setRefreshing(true);
    await list.refetch();
    setRefreshing(false);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    setRemoveError(null);
    remove.mutate(deleting.id, {
      onSuccess: () => setDeleting(null),
      onError: (error) => {
        setDeleting(null);
        // A note someone else already deleted is gone from the list once it reloads; that is what was asked for.
        if (failureKindOf(error) !== 'missing') setRemoveError(error);
      },
    });
  };

  const denied = (
    <EmptyState
      icon="lock-closed-outline"
      title={t('contactNotes.denied.title')}
      hint={t('contactNotes.denied.hint')}
    />
  );
  const missing = <EmptyState icon="people-outline" title={t('contactNotes.contactMissing')} />;

  const staleError = removeError ?? (list.isError && notes.length > 0 ? list.error : null);

  let body;
  if (session.data === undefined) {
    body = session.isError ? (
      <View style={styles.pad}>
        <ErrorCard error={session.error} onRetry={() => void session.refetch()} />
      </View>
    ) : (
      <NotesSkeleton />
    );
  } else if (!canRead) {
    body = denied;
  } else if (contactId === '') {
    body = missing;
  } else if (list.isPending) {
    body = <NotesSkeleton />;
  } else if (list.isError && notes.length === 0) {
    const kind = failureKindOf(list.error);
    body =
      kind === 'missing' ? (
        missing
      ) : kind === 'denied' ? (
        denied
      ) : (
        <View style={styles.pad}>
          <ErrorCard error={list.error} onRetry={() => void list.refetch()} />
        </View>
      );
  } else {
    body = (
      <FlatList
        testID="notes-list"
        data={notes}
        keyExtractor={(note) => note.id}
        renderItem={({ item }) => (
          <NoteRow
            note={item}
            locale={locale}
            editable={canUpdate}
            onOpen={openForm}
            onMenu={openMenu}
          />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListHeaderComponent={
          staleError ? <Banner tone="danger" message={messageForError(staleError, t)} /> : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="document-text-outline"
            title={t('contactNotes.empty.title')}
            hint={canUpdate ? t('contactNotes.empty.hint') : undefined}
          />
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.footer} />
          ) : null
        }
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('contactNotes.title')} onBack={back} />
      <View style={styles.fill}>{body}</View>

      {canUpdate && canRead && contactId !== '' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('contactNotes.add')}
          onPress={() => router.push({ pathname: '/contact-note', params: { contactId } })}
          style={[styles.fab, { backgroundColor: colors.primary, shadowColor: colors.shadow }]}
        >
          <Icon name="add" size={24} color="onPrimary" />
        </Pressable>
      ) : null}

      {menuFor ? (
        <NoteMenu
          onClose={() => setMenuFor(null)}
          onEdit={() => {
            setMenuFor(null);
            openForm(menuFor);
          }}
          onDelete={() => {
            setDeleting(menuFor);
            setMenuFor(null);
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDeleteModal
          title={t('contactNotes.delete.title')}
          message={t('contactNotes.delete.message')}
          confirmLabel={t('contactNotes.deleteConfirm')}
          cancelLabel={t('contactNotes.cancel')}
          pending={remove.isPending}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: spacing.lg },
  footer: { paddingVertical: spacing.lg },
  // Room under the last row for the round button, so it never covers a note.
  listContent: {
    flexGrow: 1,
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: FAB_SIZE + FAB_MARGIN * 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  main: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingStart: spacing.lg,
    paddingEnd: spacing.sm,
  },
  more: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  item: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  skeleton: { padding: spacing.lg, gap: spacing.sm },
  skeletonRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  line: { height: 12, borderRadius: radius.sm },
  long: { width: '70%' },
  short: { width: '35%' },
  fab: {
    position: 'absolute',
    end: FAB_MARGIN,
    bottom: FAB_MARGIN,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
