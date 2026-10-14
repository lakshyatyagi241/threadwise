'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import type { EmailTemplate, EmailTemplateRenderResponse } from '@crm/contracts';
import { Badge, Button, ConfirmDialog, Popover, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { templatesApi, useTemplatePicker } from '../api/templates';
import { errorKind } from '../lib/errors';
import { useDebounced } from '../lib/use-debounced';
import { TemplateIcon } from './icons';

/** A template filled in for the open conversation: what the composer puts in its box. */
export interface AppliedTemplate extends EmailTemplateRenderResponse {
  id: string;
  name: string;
  purpose: EmailTemplate['purpose'];
}

/**
 * The email composer's "Templates" button: pick a template, it is filled in for THIS conversation (contact, you, workspace) and handed to
 * the composer, which puts it in the box for the agent to read and edit. Nothing is sent from here. Replacing text the agent already
 * wrote asks first. Hidden for people without `mail.templates.read`.
 */
export function EmailTemplatePicker({
  conversationId,
  hasDraft,
  disabled,
  applied,
  onApply,
  onForget,
}: {
  conversationId: string;
  /** The box already holds text the template would replace. */
  hasDraft: boolean;
  disabled?: boolean;
  /** The template the box was last filled from, if any. */
  applied: { name: string; marketing: boolean } | null;
  onApply: (template: AppliedTemplate) => void;
  onForget: () => void;
}) {
  const t = useTranslations('emailTemplates.picker');
  const tErr = useTranslations('emailTemplates.errors');
  const can = useCan('mail.templates.read');
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const list = useTemplatePicker(dq, open && can);
  const [pending, setPending] = useState<EmailTemplate | null>(null);

  const use = useMutation({
    mutationFn: (tpl: EmailTemplate) =>
      templatesApi
        .render(tpl.id, conversationId)
        .then((r): AppliedTemplate => ({ ...r, id: tpl.id, name: tpl.name, purpose: tpl.purpose })),
    onSuccess: (filled) => {
      setOpen(false);
      setPending(null);
      onApply(filled);
    },
    onError: () => setPending(null),
  });

  if (!can) return null;
  const choose = (tpl: EmailTemplate) => {
    if (hasDraft) setPending(tpl);
    else use.mutate(tpl);
  };

  return (
    <div data-testid="email-template-picker" className="mx-3 mt-2 space-y-1 text-xs">
      <div className="relative flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          data-testid="email-template-picker-button"
          disabled={disabled || use.isPending}
          onClick={() => setOpen((o) => !o)}
        >
          {use.isPending ? <Spinner /> : <TemplateIcon />} {t('button')}
        </Button>
        {applied && (
          <span data-testid="email-template-applied" className="text-muted-foreground">
            {t('used', { name: applied.name })}
            <button
              type="button"
              data-testid="email-template-forget"
              className="ms-2 rounded underline focus-visible:ring-2 focus-visible:ring-primary"
              onClick={onForget}
            >
              {t('forget')}
            </button>
          </span>
        )}
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          label={t('title')}
          className="start-0 top-full z-20 mt-1 w-[min(26rem,calc(100vw-2rem))] p-2"
        >
          <div id={panelId}>
            <input
              type="search"
              dir="auto"
              aria-label={t('search')}
              placeholder={t('searchPlaceholder')}
              value={q}
              maxLength={100}
              onChange={(e) => setQ(e.target.value)}
              className="mb-2 h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            {list.isPending ? (
              <p role="status" className="flex items-center gap-2 p-2 text-muted-foreground">
                <Spinner /> {t('loading')}
              </p>
            ) : list.isError ? (
              <p role="alert" className="p-2 text-danger">
                {t('loadError')}
              </p>
            ) : list.items.length === 0 ? (
              <p className="p-2 text-muted-foreground">{dq ? t('emptyFiltered') : t('empty')}</p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {list.items.map((tpl) => (
                  <li key={tpl.id}>
                    <button
                      type="button"
                      data-testid="email-template-option"
                      onClick={() => choose(tpl)}
                      className="w-full rounded-md px-2 py-1.5 text-start outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span dir="auto" className="break-words text-sm font-medium">
                          {tpl.name}
                        </span>
                        {tpl.scope === 'mine' && <Badge tone="success">{t('mine')}</Badge>}
                        {tpl.purpose === 'marketing' && (
                          <Badge tone="warning">{t('marketing')}</Badge>
                        )}
                      </span>
                      {tpl.subject && (
                        <span dir="auto" className="block break-words text-muted-foreground">
                          {tpl.subject}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
                {list.hasNextPage && (
                  <li>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={list.isFetchingNextPage}
                      onClick={() => void list.fetchNextPage()}
                    >
                      {t('more')}
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </Popover>
      </div>
      {use.isError && (
        <p role="alert" data-testid="email-template-error" className="text-danger">
          {tErr(errorKind(use.error))}
        </p>
      )}
      {applied?.marketing && (
        <p role="note" data-testid="email-template-marketing" className="text-warning">
          {t('marketingNote')}
        </p>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={t('replaceTitle')}
        message={t('replaceMessage', { name: pending?.name ?? '' })}
        confirmLabel={t('replaceConfirm')}
        cancelLabel={t('replaceCancel')}
        busy={use.isPending}
        onConfirm={() => pending && use.mutate(pending)}
        onClose={() => setPending(null)}
      />
    </div>
  );
}
