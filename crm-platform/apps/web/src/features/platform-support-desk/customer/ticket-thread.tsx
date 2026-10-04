'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customerTicketDetailSchema } from '@crm/contracts';
import { Alert, Button, Card, Spinner, Textarea, cn } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import { STATUS_PILL, errorKey, formatWhen } from '../lib/display';
import { relativeTime } from '../lib/format';
import { TICKETS_KEY } from './support-screen';

const NS = 'platform-support-desk';

/** One ticket's thread for its owner, with the follow-up box (hidden once the ticket is closed). */
export function TicketThread({ id }: { id: string }) {
  const t = useTranslations(`${NS}.customer.thread`);
  const te = useTranslations(`${NS}.errors`);
  const ts = useTranslations(`${NS}.status`);
  const locale = useLocale();
  const qc = useQueryClient();
  const key = [...TICKETS_KEY, id] as const;
  const [body, setBody] = useState('');

  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      apiFetch(`/support/tickets/${id}`, { schema: customerTicketDetailSchema, signal }),
  });

  const reply = useMutation({
    mutationFn: (text: string) =>
      apiFetch(`/support/tickets/${id}/reply`, {
        method: 'POST',
        body: { body: text },
        schema: customerTicketDetailSchema,
      }),
    onSuccess: (detail) => {
      setBody('');
      qc.setQueryData(key, detail);
      return qc.invalidateQueries({ queryKey: TICKETS_KEY, exact: true });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (body.trim()) reply.mutate(body);
  };

  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="danger">{te(errorKey(q.error))}</Alert>;
  const d = q.data;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <header className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <Link href="/support" className="hover:text-foreground">
            {t('crumb')}
          </Link>{' '}
          · #{d.ticketNumber}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{d.subject}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span
            className={cn(
              'rounded-full px-2.5 py-0.5 text-[11px] lowercase',
              STATUS_PILL[d.status],
            )}
          >
            {ts(d.status).replace('_', ' ')}
          </span>
          <span>{t('opened', { date: relativeTime(d.createdAt, locale) })}</span>
          {d.resolvedAt && (
            <span>{t('resolved', { date: relativeTime(d.resolvedAt, locale) })}</span>
          )}
        </div>
      </header>

      <ol className="space-y-3">
        {d.messages.map((m, i) => (
          <li
            key={m.id ?? `initial-${i}`}
            className={cn(
              'rounded-md border p-3',
              m.role === 'support' ? 'border-primary/40 bg-primary/5' : 'border-border',
            )}
          >
            <p className="mb-1 font-mono text-[10.5px] text-muted-foreground">
              {m.role === 'support' ? t('support') : t('you')}
              {m.role === 'initial'
                ? ` · ${t('initial')}`
                : ` · ${formatWhen(m.createdAt, locale)}`}
            </p>
            <p className="whitespace-pre-wrap text-sm">{m.body}</p>
          </li>
        ))}
      </ol>

      {d.status === 'closed' ? (
        <Card className="space-y-2">
          <p className="text-sm">{t('closed')}</p>
          <Link href="/support" className="text-sm font-medium text-primary hover:underline">
            {t('openNew')}
          </Link>
        </Card>
      ) : (
        <Card>
          <form onSubmit={submit} className="space-y-3">
            <h2 className="text-lg font-semibold">{t('replyTitle')}</h2>
            {d.status === 'resolved' && (
              <p className="text-xs text-muted-foreground">{t('reopenHint')}</p>
            )}
            {reply.isError && <Alert tone="danger">{te(errorKey(reply.error))}</Alert>}
            <Textarea
              aria-label={t('replyTitle')}
              rows={4}
              maxLength={8000}
              required
              value={body}
              placeholder={t('replyPlaceholder')}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={reply.isPending || !body.trim()}>
                {reply.isPending ? t('sending') : t('send')}
              </Button>
            </div>
          </form>
        </Card>
      )}
      <Link href="/support" className="inline-block text-xs text-primary hover:underline">
        ← {t('back')}
      </Link>
    </div>
  );
}
