'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import type { InboxTemplateOption } from '@crm/contracts';
import { Badge, Button, Input, Modal, Spinner, cn, useToast } from '@crm/ui';
import { useConversationTemplates } from '../api/hooks';
import { previewBody, sendableValues, slotProblems } from '../lib/template-form';
import { useErrorText } from './parts';

export interface TemplatePickerProps {
  conversationId: string;
  open: boolean;
  onClose: () => void;
  /** Sends the template; rejects with the API error so the dialog can show it and stay open. */
  onSend: (input: { templateId: string; variables: Record<string, string> }) => Promise<void>;
}

/**
 * The template picker: an approved template of this conversation's WhatsApp number, with a box for each `{{n}}` of its body and a
 * live preview of what the customer will read. A template does not need the 24 hour window, so this is how an agent reaches a
 * customer whose window has closed. A template the inbox cannot fill in (a media header, a link variable) is listed, disabled, with
 * the reason, so it is never a mystery why one known from the library is not offered.
 */
export function TemplatePicker(props: TemplatePickerProps) {
  // Mounted only while open: closing unmounts it, so the next opening starts at the list with nothing left over.
  return props.open ? <TemplatePickerDialog {...props} /> : null;
}

function TemplatePickerDialog(props: TemplatePickerProps) {
  const t = useTranslations('team-inbox-conversations.templates');
  const errorText = useErrorText();
  const { toast } = useToast();
  const searchId = useId();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<InboxTemplateOption | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The search goes to the server after a short pause, so a long library is not fetched on every keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setQ(search.trim()), 250);
    return () => window.clearTimeout(id);
  }, [search]);

  const list = useConversationTemplates(props.conversationId, true, q);
  const items = useMemo(() => list.data?.data ?? [], [list.data]);

  const problems = picked ? slotProblems(picked, values) : {};
  const canSend = picked !== null && picked.sendable && Object.keys(problems).length === 0;

  function choose(template: InboxTemplateOption) {
    if (!template.sendable) return;
    setPicked(template);
    setValues({});
    setTouched(false);
    setError(null);
  }

  async function send() {
    if (!picked) return;
    setTouched(true);
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await props.onSend({ templateId: picked.id, variables: sendableValues(picked, values) });
      toast(t('sent'));
      props.onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open
      onClose={props.onClose}
      size="lg"
      title={picked ? picked.name : t('title')}
      eyebrow={t('eyebrow')}
      closeLabel={t('close')}
      footer={
        picked ? (
          <>
            <Button
              variant="ghost"
              type="button"
              data-testid="inbox-template-back"
              onClick={() => {
                setPicked(null);
                setError(null);
              }}
              disabled={sending}
            >
              {t('back')}
            </Button>
            <Button
              type="button"
              data-testid="inbox-template-send"
              onClick={() => void send()}
              disabled={sending || (touched && !canSend)}
            >
              {sending && <Spinner />}
              {sending ? t('sending') : t('send')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" type="button" onClick={props.onClose}>
            {t('cancel')}
          </Button>
        )
      }
    >
      {picked ? (
        <div className="space-y-4" data-testid="inbox-template-form">
          <p className="text-xs text-muted-foreground">{t('windowHint')}</p>

          {picked.slots.length > 0 && (
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-medium">{t('variables')}</legend>
              {picked.slots.map((slot, i) => {
                const id = `${searchId}-${slot.key}`;
                const problem = touched ? problems[slot.key] : undefined;
                return (
                  <div key={slot.key} className="space-y-1">
                    <label htmlFor={id} className="block text-sm">
                      <span className="me-1 font-mono text-xs text-muted-foreground">{`{{${slot.key}}}`}</span>
                      {slot.label}
                    </label>
                    <Input
                      id={id}
                      value={values[slot.key] ?? ''}
                      invalid={problem !== undefined}
                      autoFocus={i === 0}
                      maxLength={1024}
                      placeholder={slot.example ?? undefined}
                      data-testid={`inbox-template-var-${slot.key}`}
                      aria-describedby={problem ? `${id}-error` : undefined}
                      onChange={(e) => setValues((cur) => ({ ...cur, [slot.key]: e.target.value }))}
                    />
                    {problem && (
                      <p id={`${id}-error`} role="alert" className="text-xs text-danger">
                        {t(`problem.${problem}`, { label: slot.label })}
                      </p>
                    )}
                  </div>
                );
              })}
            </fieldset>
          )}

          <div>
            <p className="mb-1 text-sm font-medium">{t('preview')}</p>
            <div
              data-testid="inbox-template-preview"
              className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm"
            >
              {picked.header && <p className="font-semibold">{picked.header}</p>}
              <p className="whitespace-pre-wrap break-words" dir="auto">
                {previewBody(picked.body, values)}
              </p>
              {picked.footer && <p className="text-xs text-muted-foreground">{picked.footer}</p>}
              {picked.buttons.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {picked.buttons.map((b, i) => (
                    <span
                      key={`${b}-${i}`}
                      className="rounded-md border border-border bg-background px-2 py-0.5 text-xs text-primary"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error && (
            <p role="alert" data-testid="inbox-template-error" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor={searchId} className="sr-only">
              {t('searchLabel')}
            </label>
            <Input
              id={searchId}
              type="search"
              value={search}
              placeholder={t('search')}
              data-testid="inbox-template-search"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {list.isPending && (
            <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner /> {t('loading')}
            </p>
          )}
          {list.isError && (
            <div role="alert" className="space-y-2 py-4 text-sm">
              <p className="text-danger">{t('loadError')}</p>
              <Button variant="ghost" type="button" onClick={() => void list.refetch()}>
                {t('retry')}
              </Button>
            </div>
          )}
          {list.data && items.length === 0 && (
            <p
              data-testid="inbox-template-empty"
              className="py-6 text-center text-sm text-muted-foreground"
            >
              {q ? t('noResults') : t('empty')}
            </p>
          )}

          <ul
            className="max-h-[50vh] space-y-1.5 overflow-y-auto"
            data-testid="inbox-template-list"
          >
            {items.map((tpl) => (
              <li key={tpl.id}>
                <button
                  type="button"
                  disabled={!tpl.sendable}
                  onClick={() => choose(tpl)}
                  data-testid={`inbox-template-${tpl.name}`}
                  className={cn(
                    'w-full rounded-lg border border-border p-3 text-start focus-visible:ring-2 focus-visible:ring-primary',
                    tpl.sendable ? 'hover:bg-muted' : 'cursor-not-allowed opacity-60',
                  )}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{tpl.name}</span>
                    <Badge>{tpl.language}</Badge>
                    <Badge tone={tpl.category === 'MARKETING' ? 'warning' : 'neutral'}>
                      {tpl.category}
                    </Badge>
                  </span>
                  <span
                    className="mt-1 line-clamp-2 block text-xs text-muted-foreground"
                    dir="auto"
                  >
                    {tpl.body}
                  </span>
                  {tpl.reason && (
                    <span className="mt-1 block text-xs text-danger">
                      {t(`reason.${tpl.reason}`)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
