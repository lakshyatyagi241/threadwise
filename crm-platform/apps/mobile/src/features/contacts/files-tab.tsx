import type { ContactFileResponse } from '@crm/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { formatDate } from './contact-display';
import { ConfirmDeleteModal, ErrorCard } from './record-parts';
import { failureKindOf, joinMeta } from './record-support';
import { useContactFiles, useDeleteFile } from './use-files';

interface Props {
  contactId: string;
  /** Whether the person may delete a file record (`record.contacts.update`). */
  canUpdate: boolean;
}

const KB = 1024;
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** A size the way a person reads it: "812 B", "12 KB", "1.5 MB". Null when the API does not know the size. */
export function formatFileSize(bytes: number | null, locale: string): string | null {
  if (bytes === null || bytes < 0) return null;
  let value = bytes;
  let unit = 0;
  while (value >= KB && unit < SIZE_UNITS.length - 1) {
    value /= KB;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  const text = value.toLocaleString(locale, { maximumFractionDigits: digits });
  return `${text} ${SIZE_UNITS[unit]}`;
}

/** The icon for a file, from its type; a type the app does not know gets the plain page. */
function iconFor(mimeType: string | null): IconName {
  const type = (mimeType ?? '').toLowerCase();
  if (type.startsWith('image/')) return 'image-outline';
  if (type.startsWith('video/')) return 'videocam-outline';
  if (type.startsWith('audio/')) return 'musical-notes-outline';
  if (type === 'application/pdf' || type.startsWith('text/')) return 'document-text-outline';
  if (/sheet|excel|csv/.test(type)) return 'grid-outline';
  if (/zip|compressed|tar|rar/.test(type)) return 'archive-outline';
  return 'document-outline';
}

function FileRow({
  file,
  locale,
  onDelete,
}: {
  file: ContactFileResponse;
  locale: string;
  /** Present when the person may delete the record. */
  onDelete?: (file: ContactFileResponse) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View accessible style={styles.main}>
        <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
          <Icon name={iconFor(file.mimeType)} size={22} color="textMuted" />
        </View>
        <View style={styles.text}>
          <Text numberOfLines={2}>{file.fileName}</Text>
          <Text variant="caption" muted>
            {joinMeta([
              formatFileSize(file.fileSizeBytes, locale),
              formatDate(file.createdAt, locale),
            ])}
          </Text>
        </View>
      </View>
      {onDelete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('contactNotes.files.delete', { name: file.fileName })}
          onPress={() => onDelete(file)}
          style={styles.remove}
        >
          <Icon name="trash-outline" size={20} color="textMuted" />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The Files tab of a contact: the files recorded against the contact with an icon for their type, name, size and date, newest
 * first, with a "Load more" button (the tab sits inside the contact's own scroll view). People who may update contacts can delete
 * a record, after a question.
 *
 * Read-only on purpose. The API stores file records (name, size, type) and has no route that takes the bytes of a file or gives
 * them back, so the app has nothing to add or open until the backend gets file storage.
 */
export function FilesTab({ contactId, canUpdate }: Props) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const canRead = can(session.data, 'record.contacts.read');
  const files = useContactFiles(contactId, canRead);
  const remove = useDeleteFile(contactId);
  const [deleting, setDeleting] = useState<ContactFileResponse | null>(null);
  const [removeError, setRemoveError] = useState<unknown>(null);

  const rows = useMemo(() => files.data?.pages.flatMap((page) => page.data) ?? [], [files.data]);
  const locale = i18n.language;

  const confirmDelete = () => {
    if (!deleting) return;
    setRemoveError(null);
    remove.mutate(deleting.id, {
      onSuccess: () => setDeleting(null),
      onError: (error) => {
        setDeleting(null);
        // A record someone else already deleted is gone from the list once it reloads; that is what was asked for.
        if (failureKindOf(error) !== 'missing') setRemoveError(error);
      },
    });
  };

  let body;
  if (!canRead) {
    body = null;
  } else if (files.isPending) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (files.isError && rows.length === 0) {
    body =
      failureKindOf(files.error) === 'other' ? (
        <ErrorCard error={files.error} onRetry={() => void files.refetch()} />
      ) : null;
  } else if (rows.length === 0) {
    body = <EmptyState icon="folder-open-outline" title={t('contactNotes.files.empty')} />;
  } else {
    body = (
      <View style={styles.list}>
        {rows.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            locale={locale}
            onDelete={canUpdate ? setDeleting : undefined}
          />
        ))}
        {files.hasNextPage ? (
          <Button
            variant="secondary"
            label={t('contactNotes.loadMore')}
            loading={files.isFetchingNextPage}
            onPress={() => void files.fetchNextPage()}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {removeError ? <Banner tone="danger" message={messageForError(removeError, t)} /> : null}
      {body}
      {deleting ? (
        <ConfirmDeleteModal
          title={t('contactNotes.files.deleteTitle')}
          message={t('contactNotes.files.deleteMessage')}
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
  root: { gap: spacing.lg },
  loading: { marginVertical: spacing.xl },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  main: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: spacing.xs },
  remove: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
