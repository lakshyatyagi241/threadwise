'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, EmptyState, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useFormTemplates } from '../api/forms';
import { fieldsOf } from '../lib/builder-model';
import { NewFormDialog, type StartMode } from './new-form-dialog';

/**
 * `/forms/templates`: the gallery (lead capture, contact us, event registration, order and payment, survey). Choosing one opens the
 * same "New form" dialog with the template selected, so a person names the form and lands in the builder with a draft.
 */
export function TemplatesScreen() {
  const t = useTranslations('web-forms.templates');
  const templates = useFormTemplates();
  const canCreate = useCan('record.forms.create');
  const [dialog, setDialog] = useState<{ mode: StartMode; template: string | null } | null>(null);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav aria-label={t('breadcrumb')} className="text-xs text-muted-foreground">
            <Link href="/forms" className="hover:underline">
              {t('back')}
            </Link>
          </nav>
          <h1 className="mt-1 text-2xl font-semibold">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canCreate && (
          <Button variant="secondary" onClick={() => setDialog({ mode: 'blank', template: null })}>
            {t('blank')}
          </Button>
        )}
      </header>

      <div className="mt-6">
        {templates.isPending && (
          <div className="flex justify-center py-16">
            <Spinner label={t('loading')} />
          </div>
        )}
        {templates.isError && (
          <Alert tone="danger" className="flex items-center justify-between gap-3">
            <span>{t('loadFailed')}</span>
            <Button size="sm" variant="secondary" onClick={() => void templates.refetch()}>
              {t('retry')}
            </Button>
          </Alert>
        )}
        {templates.data && templates.data.length === 0 && <EmptyState title={t('empty')} />}
        {templates.data && templates.data.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.data.map((tpl) => {
              const fields = fieldsOf(tpl.definition).filter((f) => f.kind !== 'hidden');
              return (
                <li
                  key={tpl.key}
                  className="flex flex-col rounded-md border border-border bg-background p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-base font-semibold">{tpl.name}</h2>
                    <Badge>{t(`category.${tpl.category}`)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{tpl.description}</p>
                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('fields')}>
                    {fields.slice(0, 6).map((f) => (
                      <li
                        key={f.id}
                        className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {f.label}
                      </li>
                    ))}
                    {fields.length > 6 && (
                      <li className="px-1 py-0.5 text-xs text-muted-foreground">
                        {t('more', { count: fields.length - 6 })}
                      </li>
                    )}
                  </ul>
                  {canCreate && (
                    <div className="mt-auto pt-4">
                      <Button
                        variant="secondary"
                        className="w-full"
                        onClick={() => setDialog({ mode: 'template', template: tpl.key })}
                      >
                        {t('use')}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <NewFormDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        mode={dialog?.mode ?? 'template'}
        onMode={(mode) => setDialog((d) => (d ? { ...d, mode } : d))}
        templateKey={dialog?.template ?? null}
        onTemplate={(template) => setDialog((d) => (d ? { ...d, template } : d))}
      />
    </main>
  );
}
