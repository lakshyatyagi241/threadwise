'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SUPP_TICKET_REASONS,
  customerTicketItemSchema,
  customerTicketListResponseSchema,
  type SuppTicketReason,
} from '@crm/contracts';
import { Alert, Badge, Button, Card, Field, Input, Spinner, Textarea, cn } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { STATUS_TONE, errorKey, formatWhen } from '../lib/display';

const NS = 'platform-support-desk';
export const TICKETS_KEY = ['support', 'tickets'] as const;

/** The customer's help page: pick a reason, write to support, and see the last ten tickets. */
export function SupportScreen() {
  const { user } = useSession();
  const prefill = { name: user.displayName ?? user.fullName, email: user.email };
  const t = useTranslations(`${NS}.customer`);
  const te = useTranslations(`${NS}.errors`);
  const ts = useTranslations(`${NS}.status`);
  const tr = useTranslations(`${NS}.reason`);
  const locale = useLocale();
  const qc = useQueryClient();
  const [reason, setReason] = useState<SuppTicketReason>('bug');
  const [justSubmitted, setJustSubmitted] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());

  const history = useQuery({
    queryKey: TICKETS_KEY,
    queryFn: ({ signal }) =>
      apiFetch('/support/tickets', {
        query: { limit: 10 },
        schema: customerTicketListResponseSchema,
        signal,
      }),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, string>) =>
      apiFetch('/support/tickets', { method: 'POST', body, schema: customerTicketItemSchema }),
    onSuccess: (ticket) => {
      setJustSubmitted(ticket.ticketNumber);
      setFieldErrors(new Set());
      return qc.invalidateQueries({ queryKey: TICKETS_KEY });
    },
    onError: (e) =>
      setFieldErrors(new Set(e instanceof ApiError ? e.fieldErrors.map((f) => f.path) : [])),
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      reason,
      name: String(f.get('name') ?? ''),
      email: String(f.get('email') ?? ''),
      subject: String(f.get('subject') ?? ''),
      message: String(f.get('message') ?? ''),
    };
    create.mutate(body, {
      onSuccess: () => {
        (e.target as HTMLFormElement).reset?.();
      },
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {justSubmitted && (
        <Alert tone="success" data-testid="created-banner">
          {t('created', { number: justSubmitted })}
        </Alert>
      )}
      {create.isError && (
        <Alert tone="danger">
          {te(errorKey(create.error))}
          {create.error instanceof ApiError && create.error.requestId && (
            <span className="ms-2 font-mono text-xs">
              {te('requestId')}: {create.error.requestId}
            </span>
          )}
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        <nav aria-label={t('pickReason')} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('pickReason')}
          </p>
          {SUPP_TICKET_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
              className={cn(
                'w-full rounded-md border px-3 py-2 text-start text-sm',
                reason === r ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
              )}
            >
              <span className="block font-medium">{tr(`${r}.label`)}</span>
              <span className="block text-xs text-muted-foreground">{tr(`${r}.hint`)}</span>
            </button>
          ))}
        </nav>

        <Card>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {tr(`${reason}.label`)}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('form.name')} htmlFor="sp-name">
                <Input
                  id="sp-name"
                  name="name"
                  required
                  maxLength={191}
                  defaultValue={prefill?.name}
                  invalid={fieldErrors.has('name')}
                />
              </Field>
              <Field label={t('form.email')} htmlFor="sp-email" hint={t('form.emailHint')}>
                <Input
                  id="sp-email"
                  name="email"
                  type="email"
                  required
                  maxLength={191}
                  defaultValue={prefill?.email}
                  invalid={fieldErrors.has('email')}
                />
              </Field>
            </div>
            <Field label={t('form.subject')} htmlFor="sp-subject">
              <Input
                id="sp-subject"
                name="subject"
                required
                maxLength={191}
                invalid={fieldErrors.has('subject')}
              />
            </Field>
            <Field label={t('form.message')} htmlFor="sp-message">
              <Textarea
                id="sp-message"
                name="message"
                rows={7}
                required
                maxLength={20000}
                invalid={fieldErrors.has('message')}
              />
            </Field>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t('form.sending') : t('form.submit')}
            </Button>
          </form>
        </Card>
      </div>

      <section aria-labelledby="sp-history" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="sp-history" className="text-lg font-semibold">
            {t('history.title')}
          </h2>
          {history.data && history.data.summary.total > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('history.all', {
                open: history.data.summary.open,
                total: history.data.summary.total,
              })}
            </span>
          )}
        </div>
        {history.isPending && <Spinner />}
        {history.isError && <Alert tone="danger">{te(errorKey(history.error))}</Alert>}
        {history.data && history.data.data.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
        )}
        <ul className="space-y-2">
          {history.data?.data.map((tk) => (
            <li key={tk.id}>
              <Link
                href={`/support/${tk.id}`}
                className="block rounded-md border border-border p-3 hover:bg-muted"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono">#{tk.ticketNumber}</span>
                  <Badge tone={STATUS_TONE[tk.status]}>{ts(tk.status)}</Badge>
                  {tk.ticketNumber === justSubmitted && (
                    <Badge tone="success">{t('history.justSubmitted')}</Badge>
                  )}
                  <span className="ms-auto text-muted-foreground">
                    {formatWhen(tk.createdAt, locale)}
                  </span>
                </div>
                <p className="mt-1 font-medium">{tk.subject}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{tk.excerpt}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
