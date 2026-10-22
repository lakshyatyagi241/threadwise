'use client';

import { useId, useRef, useState, type ChangeEvent } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { ERROR_CODES, type ContactFileResponse } from '@crm/contracts';
import { Button, ConfirmDialog, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { useContactFiles, useRemoveContactFile, useUploadContactFile } from '../../api/files';
import { fileTypeOf, formatBytes } from '../../lib/contact-files';
import { errorKind } from '../../lib/errors';
import { ErrorLine } from '../error-line';
import { EmptyLine, Panel, type SectionProps } from './shared';

/**
 * The files recorded against the contact: name, size, type, when and by whom (the person's id; names are not looked up).
 * People who may update the contact can add a file (the server reads its type and size from the bytes) and remove one
 * from the list; everyone who can read the contact sees the list.
 */
export function FilesSection({ contact, variant }: SectionProps) {
  const t = useTranslations('contacts-attributes-tags.contact.files');
  const locale = useLocale();
  const format = useFormatter();
  const { toast } = useToast();
  const canUpdate = useCan('record.contacts.update');
  const list = useContactFiles(contact.id);
  const upload = useUploadContactFile(contact.id);
  const remove = useRemoveContactFile(contact.id);
  const [deleting, setDeleting] = useState<ContactFileResponse | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so that picking the same file again still fires a change.
    event.target.value = '';
    if (!file) return;
    upload.mutate(file, {
      onSuccess: () => toast(t('added')),
      onError: (err) => {
        const rejected = err instanceof ApiError && err.code === ERROR_CODES.AUTH_UPLOAD_REJECTED;
        toast(rejected ? t('uploadRejected') : t('uploadFailed'), 'danger');
      },
    });
  };

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        setDeleting(null);
        toast(t('deleted'));
      },
      onError: (e) => {
        setDeleting(null);
        toast(errorKind(e) === 'forbidden' ? t('forbidden') : t('deleteFailed'), 'danger');
      },
    });
  };

  return (
    <Panel
      id={titleId}
      title={t('title')}
      bodyClassName={variant === 'drawer' ? 'px-3' : undefined}
      action={
        canUpdate ? (
          <>
            <input ref={fileInput} type="file" hidden onChange={pickFile} />
            <Button
              variant="secondary"
              size="sm"
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              {upload.isPending && <Spinner label={t('uploading')} />}
              {t('upload')}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {list.isPending && (
          <div className="flex justify-center py-6">
            <Spinner label={t('loading')} />
          </div>
        )}
        {list.isError && <ErrorLine error={list.error} onRetry={() => void list.refetch()} />}
        {list.isSuccess && list.items.length === 0 && <EmptyLine>{t('empty')}</EmptyLine>}
        {list.items.length > 0 && (
          <ul aria-label={t('listLabel')} className="divide-y divide-border">
            {list.items.map((f) => {
              const size = formatBytes(f.fileSizeBytes, locale) ?? t('unknownSize');
              const type = fileTypeOf(f.mimeType, f.fileName);
              return (
                <li
                  key={f.id}
                  className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p dir="auto" className="break-words text-sm font-medium">
                      {f.fileName}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span dir="ltr">{size}</span>
                      {type && (
                        <>
                          <span aria-hidden="true">&middot;</span>
                          <span dir="ltr" className="break-all">
                            {type}
                          </span>
                        </>
                      )}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>
                        {t('uploaded', {
                          when: format.dateTime(new Date(f.createdAt), { dateStyle: 'medium' }),
                        })}
                      </span>
                      {f.uploadedBy && (
                        <>
                          <span aria-hidden="true">&middot;</span>
                          <span dir="ltr" title={f.uploadedBy}>
                            {t('uploadedBy', { id: f.uploadedBy.slice(0, 8) })}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  {canUpdate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      aria-label={t('deleteAria', { name: f.fileName })}
                      onClick={() => setDeleting(f)}
                    >
                      {t('delete')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {list.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage && <Spinner label={t('loadingMore')} />}
              {t('loadMore')}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        busy={remove.isPending}
        title={t('deleteTitle')}
        message={t('deleteMessage', { name: deleting?.fileName ?? '' })}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('keep')}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </Panel>
  );
}
