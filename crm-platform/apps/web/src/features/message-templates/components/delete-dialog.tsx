'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog, useToast } from '@crm/ui';
import { useDeleteTemplate } from '../api/hooks';
import { ErrorAlert } from './error-line';
import { useErrorText, type ErrorText } from './use-error-text';

/**
 * Confirms and deletes a template (local and on Meta). TPL_IN_USE (a running or scheduled broadcast uses it) is explained,
 * not just reported, so the operator knows what to do next.
 */
export function DeleteTemplateDialog({
  template,
  onClose,
  onDeleted,
}: {
  template: { id: string; name: string } | null;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const t = useTranslations('message-templates.delete');
  const { toast } = useToast();
  const del = useDeleteTemplate();
  const message = useErrorText();
  const [error, setError] = useState<ErrorText | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  return (
    <ConfirmDialog
      open={template !== null}
      title={t('title')}
      message={
        <div className="space-y-3">
          <p>{t('message', { name: template?.name ?? '' })}</p>
          {error && (
            <>
              <ErrorAlert error={error} />
              {error.code === 'TPL_IN_USE' && (
                <p role="note" className="text-foreground">
                  {t('inUseHelp')}
                </p>
              )}
            </>
          )}
        </div>
      }
      confirmLabel={t('confirm')}
      cancelLabel={t('cancel')}
      tone="danger"
      busy={del.isPending}
      onClose={close}
      onConfirm={() => {
        if (!template) return;
        setError(null);
        del.mutate(template.id, {
          onSuccess: () => {
            toast(t('done', { name: template.name }));
            setError(null);
            onClose();
            onDeleted?.();
          },
          onError: (e) => setError(message(e)),
        });
      }}
    />
  );
}
