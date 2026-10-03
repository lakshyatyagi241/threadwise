'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
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

/** Rail icon per reason: a 16x16 outline and the tint of its tile, as WaDesk draws them. */
const REASON_ICON: Record<SuppTicketReason, { tint: string; path: string }> = {
  bug: {
    tint: 'bg-danger/10 text-danger',
    path: 'M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2',
  },
  delivery: { tint: 'bg-success/10 text-success', path: 'M2 8h10M8 4l4 4-4 4M14 3v10' },
  template: { tint: 'bg-primary/10 text-primary', path: 'M2 3h12v10H2zM2 7h12M6 7v6' },
  billing: { tint: 'bg-warning/10 text-warning', path: 'M2 4h12v8H2zM2 7h12M4 10h3' },
  integration: { tint: 'bg-primary/10 text-primary', path: 'm5 5-3 3 3 3M11 5l3 3-3 3M9 3l-2 10' },
  account: {
    tint: 'bg-success/10 text-success',
    path: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 14c0-3 2-5 5-5s5 2 5 5',
  },
  other: { tint: 'bg-muted text-muted-foreground', path: 'M3 8h.01M8 8h.01M13 8h.01' },
};

const Icon = ({ path }: { path: string }) => (
  <svg
    viewBox="0 0 16 16"
    className="size-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={path} />
  </svg>
);

const sizeLabel = (bytes: number): string =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * The customer's help page (WD-SUPP-001..004, 006): a reason rail, the ticket form with WaDesk's attachment picker (it lists
 * the chosen files but, as in WaDesk, nothing is uploaded), and the last ten tickets underneath.
 */
export function SupportScreen() {
  const { user } = useSession();
  const prefill = { name: user.displayName ?? user.fullName, email: user.email };
  const t = useTranslations(`${NS}.customer`);
  const te = useTranslations(`${NS}.errors`);
  const ts = useTranslations(`${NS}.status`);
  const tr = useTranslations(`${NS}.reason`);
  const locale = useLocale();
  const qc = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [reason, setReason] = useState<SuppTicketReason>('bug');
  const [justSubmitted, setJustSubmitted] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<File[]>([]);

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
      setFiles([]);
      formRef.current?.reset();
      return qc.invalidateQueries({ queryKey: TICKETS_KEY });
    },
    onError: (e) =>
      setFieldErrors(new Set(e instanceof ApiError ? e.fieldErrors.map((f) => f.path) : [])),
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({
      reason,
      name: String(f.get('name') ?? ''),
      email: String(f.get('email') ?? ''),
      subject: String(f.get('subject') ?? ''),
      message: String(f.get('message') ?? ''),
    });
  };

  return (
    <div>
      <div className="border-b bg-background">
        <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('eyebrow')}
            </p>
            <h1 className="truncate text-xl font-semibold leading-tight">{t('headline')}</h1>
          </div>
          <Badge tone="success">{t('live')}</Badge>
        </div>
      </div>

      <div className="space-y-4 px-4 py-6 sm:px-6">
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

        <div className="grid items-start gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-lg border bg-background">
            <div className="border-b px-4 py-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('reasonEyebrow')}
              </p>
              <h2 className="text-lg font-semibold leading-tight">{t('pickReason')}</h2>
            </div>
            <ul className="divide-y" aria-label={t('pickReason')}>
              {SUPP_TICKET_REASONS.map((r) => (
                <li key={r}>
                  <button
                    type="button"
                    aria-pressed={reason === r}
                    onClick={() => setReason(r)}
                    className={cn(
                      'flex w-full items-start gap-3 border-s-[3px] px-4 py-3 text-start hover:bg-muted/60',
                      reason === r ? 'border-primary bg-muted/40' : 'border-transparent',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex size-10 shrink-0 items-center justify-center rounded-lg',
                        REASON_ICON[r].tint,
                      )}
                    >
                      <Icon path={REASON_ICON[r].path} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{tr(`${r}.label`)}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        {tr(`${r}.hint`)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <Card className="p-0">
            <div className="border-b px-6 py-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {tr(`${reason}.label`)}
              </p>
              <h2 className="mt-0.5 text-2xl font-semibold tracking-tight">{t('formTitle')}</h2>
              <p className="mt-1 max-w-[32rem] text-sm text-muted-foreground">{t('formIntro')}</p>
            </div>
            <form ref={formRef} onSubmit={submit} className="space-y-5 p-6" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`${t('form.name')} *`} htmlFor="sp-name">
                  <Input
                    id="sp-name"
                    name="name"
                    required
                    maxLength={191}
                    placeholder={t('form.name')}
                    defaultValue={prefill?.name}
                    invalid={fieldErrors.has('name')}
                  />
                </Field>
                <Field label={`${t('form.email')} *`} htmlFor="sp-email">
                  <Input
                    id="sp-email"
                    name="email"
                    type="email"
                    required
                    maxLength={191}
                    className="font-mono"
                    placeholder="you@brand.example"
                    defaultValue={prefill?.email}
                    invalid={fieldErrors.has('email')}
                  />
                </Field>
              </div>
              <Field label={`${t('form.subject')} *`} htmlFor="sp-subject">
                <Input
                  id="sp-subject"
                  name="subject"
                  required
                  maxLength={191}
                  placeholder={t('form.subjectPlaceholder')}
                  invalid={fieldErrors.has('subject')}
                />
              </Field>
              <Field
                label={`${t('form.message')} *`}
                htmlFor="sp-message"
                hint={t('form.messageHint')}
              >
                <Textarea
                  id="sp-message"
                  name="message"
                  rows={7}
                  required
                  maxLength={20000}
                  placeholder={t('form.messagePlaceholder')}
                  invalid={fieldErrors.has('message')}
                />
              </Field>

              <div className="space-y-1.5 text-sm">
                <p className="font-medium">
                  {t('form.attachments')}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    {t('form.optional')}
                  </span>
                </p>
                <label
                  htmlFor="sp-files"
                  className="block cursor-pointer rounded-lg border-2 border-dashed p-6 text-center hover:border-primary"
                >
                  <span className="mb-2 inline-flex size-10 items-center justify-center rounded-full bg-muted text-primary">
                    <Icon path="M2 3h12v10H2zM3 11l3-3 4 4 3-3" />
                  </span>
                  <span className="block text-sm font-semibold">
                    {t('form.drop')} <span className="text-primary">{t('form.browse')}</span>
                  </span>
                  <span className="mt-1 block font-mono text-xs text-muted-foreground">
                    {t('form.attachmentTypes')}
                  </span>
                  <input
                    id="sp-files"
                    type="file"
                    multiple
                    accept="image/*,.pdf,.txt,.log,.csv"
                    className="sr-only"
                    onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                  />
                </label>
                {files.length > 0 && (
                  <>
                    <ul className="space-y-1" data-testid="attachment-list">
                      {files.map((f) => (
                        <li
                          key={`${f.name}-${f.size}`}
                          className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs"
                        >
                          <span className="truncate">{f.name}</span>
                          <span className="ms-3 shrink-0 font-mono text-muted-foreground">
                            {sizeLabel(f.size)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">{t('form.attachmentNote')}</p>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <p className="text-xs text-muted-foreground">{t('terms')}</p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      formRef.current?.reset();
                      setFiles([]);
                      setFieldErrors(new Set());
                    }}
                  >
                    {t('cancel')}
                  </Button>
                  <Button type="submit" disabled={create.isPending}>
                    {create.isPending ? (
                      t('form.sending')
                    ) : (
                      <>
                        <svg
                          viewBox="0 0 16 16"
                          className="size-3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M2 8h10M8 4l4 4-4 4" />
                        </svg>
                        {t('form.submit')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </Card>

          {(history.isPending || history.isError || (history.data?.data.length ?? 0) > 0) && (
            <Card className="p-0 xl:col-start-2">
              <div className="flex items-end justify-between gap-3 border-b px-6 py-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {t('history.eyebrow')}
                  </p>
                  <h2 id="sp-history" className="text-xl font-semibold leading-tight">
                    {t('history.title')}
                  </h2>
                </div>
                {history.data && history.data.summary.total > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {t('history.all', {
                      open: history.data.summary.open,
                      total: history.data.summary.total,
                    })}
                  </span>
                )}
              </div>
              {history.isPending && (
                <div className="p-6">
                  <Spinner />
                </div>
              )}
              {history.isError && (
                <div className="p-6">
                  <Alert tone="danger">{te(errorKey(history.error))}</Alert>
                </div>
              )}
              <ul className="divide-y">
                {history.data?.data.map((tk) => (
                  <li key={tk.id}>
                    <Link
                      href={`/support/${tk.id}`}
                      className={cn(
                        'block px-6 py-4 hover:bg-muted/40',
                        tk.ticketNumber === justSubmitted && 'bg-success/10',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono text-muted-foreground">
                              #{tk.ticketNumber}
                            </span>
                            <Badge tone={STATUS_TONE[tk.status]}>{ts(tk.status)}</Badge>
                            {tk.ticketNumber === justSubmitted && (
                              <Badge tone="success">{t('history.justSubmitted')}</Badge>
                            )}
                          </div>
                          <h3 className="text-base font-semibold leading-tight">{tk.subject}</h3>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {tk.excerpt}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {formatWhen(tk.createdAt, locale)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
