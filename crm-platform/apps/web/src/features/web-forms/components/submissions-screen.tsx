'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations, useFormatter } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ERROR_CODES,
  FORM_EXPORT_MAX_ROWS,
  FORM_SUBMISSION_STATUSES,
  PLAN_UPGRADE_PATH,
  type FormSubmissionDetail,
  type FormSubmissionSummary,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Select,
  Spinner,
  Tabs,
  cn,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  KEYS,
  deleteSubmission,
  exportSubmissions,
  retrySubmission,
  useForm,
  useSubmission,
  useSubmissions,
} from '../api/forms';
import {
  SUBMISSION_TABS,
  answerView,
  canDelete,
  canRetry,
  csvFileName,
  exportInput,
  hasReason,
  isFiltered,
  isStatus,
  listFilters,
  reasonKey,
  statusTone,
  viewFromParams,
  viewToParams,
  type SubmissionView,
} from '../lib/submission-model';

const UPDATE_PERM = 'record.form-submissions.update';
const DELETE_PERM = 'record.form-submissions.delete';
const EXPORT_PERM = 'record.form-submissions.export';

const SEARCH_DELAY_MS = 300;

/** Who a submission is from, for headings and accessible names. */
function whoOf(s: FormSubmissionSummary, anonymous: string): string {
  return s.preview.name || s.preview.email || s.preview.phone || anonymous;
}

/**
 * The submissions of one form: what each visitor sent and what became of it. The view (tab, status, search, dates) lives in the
 * query string so a refresh or a shared link keeps it. Answers are personal data: they are fetched only when a row is opened.
 */
export function SubmissionsScreen({ formId }: { formId: string }) {
  const t = useTranslations('web-forms.submissions');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { toast } = useToast();
  const canExport = useCan(EXPORT_PERM);

  const view = useMemo(() => viewFromParams(params), [params]);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const setView = useCallback(
    (patch: Partial<SubmissionView>) => {
      const qs = viewToParams({ ...viewRef.current, ...patch }).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  // The search box is typed into at once but sent to the server after a pause, so each keystroke is not a request.
  const [qText, setQText] = useState(view.q);
  useEffect(() => {
    if (qText.trim() === viewRef.current.q) return;
    const timer = setTimeout(() => setView({ q: qText }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [qText, setView]);

  const form = useForm(formId);
  const filters = useMemo(() => listFilters(view), [view]);
  const list = useSubmissions(formId, filters);
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);

  const [openId, setOpenId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = openId ? (rows.find((r) => r.id === openId) ?? null) : null;

  const [exporting, setExporting] = useState(false);
  const exportBody = exportInput(view);

  const qc = useQueryClient();
  const refresh = useCallback(
    (submissionId?: string) => {
      void qc.invalidateQueries({ queryKey: KEYS.submissions(formId, {}).slice(0, 3) });
      if (submissionId)
        void qc.invalidateQueries({ queryKey: KEYS.submission(formId, submissionId) });
    },
    [qc, formId],
  );

  const closeDrawer = () => {
    setOpenId(null);
    // Some browsers do not focus a button on click, so the dialog cannot always give focus back by itself.
    opener.current?.focus();
  };

  const clearFilters = () => {
    setQText('');
    router.replace(pathname, { scroll: false });
  };

  const onExport = async () => {
    if (!exportBody || exporting) return;
    setExporting(true);
    try {
      const file = await exportSubmissions(formId, exportBody);
      const url = URL.createObjectURL(file.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = csvFileName(file.filename, form.data?.name);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(t('toast.exported'), 'success');
      if (file.truncated) toast(t('toast.exportTruncated', { max: FORM_EXPORT_MAX_ROWS }), 'info');
    } catch {
      toast(t('toast.exportFailed'), 'danger');
    } finally {
      setExporting(false);
    }
  };

  const formName = form.data?.name ?? t('formFallback');
  const locked =
    list.error instanceof ApiError && list.error.code === ERROR_CODES.PLAN_FEATURE_LOCKED;
  const capped = rows.some((r) => r.reason === 'submissions_cap');
  const filtered = isFiltered(view);

  const body = (
    <ListBody
      pending={list.isPending}
      error={list.isError ? list.error : null}
      locked={locked}
      rows={rows}
      filtered={filtered}
      formId={formId}
      hasNext={!!list.hasNextPage}
      loadingMore={list.isFetchingNextPage}
      onMore={() => void list.fetchNextPage()}
      onRetry={() => void list.refetch()}
      onClear={clearFilters}
      onOpen={(id, el) => {
        opener.current = el;
        setOpenId(id);
      }}
    />
  );

  return (
    <div className="space-y-4" data-testid="submissions-screen">
      <header className="space-y-1">
        <Link
          href={`/forms/${formId}`}
          className="inline-flex text-sm text-muted-foreground hover:text-foreground"
        >
          {t('backToForm', { name: formName })}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold" dir="auto">
              {t('title')}
            </h1>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {list.isSuccess
                ? `${t('count', { count: rows.length })}${list.hasNextPage ? `. ${t('moreAvailable')}` : ''}`
                : ''}
            </p>
          </div>
          {canExport && !locked && (
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <Button
                variant="secondary"
                onClick={() => void onExport()}
                disabled={!exportBody || exporting}
                data-testid="export-csv"
              >
                {exporting && <Spinner />}
                {exporting ? t('actions.exporting') : t('actions.export')}
              </Button>
              {!exportBody ? (
                <span className="text-xs text-muted-foreground">
                  {t('actions.exportHintAttention')}
                </span>
              ) : view.q.trim() ? (
                <span className="text-xs text-muted-foreground">
                  {t('actions.exportHintSearch')}
                </span>
              ) : null}
            </div>
          )}
        </div>
      </header>

      {capped && (
        <Alert
          tone="warning"
          data-testid="cap-notice"
          className="flex flex-wrap items-center gap-x-3"
        >
          <span>{t('cap.notice')}</span>
          <Link href={PLAN_UPGRADE_PATH} className="font-medium underline">
            {t('cap.upgrade')}
          </Link>
        </Alert>
      )}

      {!locked && (
        <Filters
          view={view}
          qText={qText}
          onQ={setQText}
          onChange={(patch) => setView(patch)}
          onClear={clearFilters}
        />
      )}

      <Tabs
        items={SUBMISSION_TABS.map((id) => ({
          id,
          label: t(`tabs.${id}`),
          content: body,
        }))}
        value={view.tab}
        onValueChange={(id) => {
          // A status picked on one tab says nothing useful on another, and could make the list empty for no visible reason.
          setView({ tab: id as SubmissionView['tab'], status: '' });
        }}
      />

      {open && (
        <SubmissionDrawer
          key={open.id}
          formId={formId}
          summary={open}
          onClose={closeDrawer}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function Filters({
  view,
  qText,
  onQ,
  onChange,
  onClear,
}: {
  view: SubmissionView;
  qText: string;
  onQ: (q: string) => void;
  onChange: (patch: Partial<SubmissionView>) => void;
  onClear: () => void;
}) {
  const t = useTranslations('web-forms.submissions');
  const id = useId();
  return (
    <div
      role="search"
      className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end"
      data-testid="submission-filters"
    >
      <div className="col-span-2 space-y-1 md:w-64">
        <label htmlFor={`${id}-q`} className="block text-xs font-medium">
          {t('filters.search')}
        </label>
        <Input
          id={`${id}-q`}
          type="search"
          value={qText}
          maxLength={120}
          placeholder={t('filters.searchPlaceholder')}
          onChange={(e) => onQ(e.target.value)}
        />
      </div>
      <div className="col-span-2 space-y-1 md:w-48">
        <label htmlFor={`${id}-status`} className="block text-xs font-medium">
          {t('filters.status')}
        </label>
        <Select
          id={`${id}-status`}
          value={view.status}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ status: isStatus(v) ? v : '' });
          }}
        >
          <option value="">{t('filters.allStatuses')}</option>
          {FORM_SUBMISSION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1 md:w-40">
        <label htmlFor={`${id}-from`} className="block text-xs font-medium">
          {t('filters.from')}
        </label>
        <Input
          id={`${id}-from`}
          type="date"
          value={view.from}
          max={view.to || undefined}
          onChange={(e) => onChange({ from: e.target.value })}
        />
      </div>
      <div className="space-y-1 md:w-40">
        <label htmlFor={`${id}-to`} className="block text-xs font-medium">
          {t('filters.to')}
        </label>
        <Input
          id={`${id}-to`}
          type="date"
          value={view.to}
          min={view.from || undefined}
          onChange={(e) => onChange({ to: e.target.value })}
        />
      </div>
      {(isFiltered(view) || qText) && (
        <div className="col-span-2 md:col-span-1">
          <Button variant="ghost" onClick={onClear}>
            {t('filters.clear')}
          </Button>
        </div>
      )}
    </div>
  );
}

function ListBody({
  pending,
  error,
  locked,
  rows,
  filtered,
  formId,
  hasNext,
  loadingMore,
  onMore,
  onRetry,
  onClear,
  onOpen,
}: {
  pending: boolean;
  error: unknown;
  locked: boolean;
  rows: FormSubmissionSummary[];
  filtered: boolean;
  formId: string;
  hasNext: boolean;
  loadingMore: boolean;
  onMore: () => void;
  onRetry: () => void;
  onClear: () => void;
  onOpen: (id: string, opener: HTMLElement) => void;
}) {
  const t = useTranslations('web-forms.submissions');

  if (pending) {
    return (
      <div
        role="status"
        aria-label={t('state.loading')}
        className="space-y-2"
        data-testid="loading"
      >
        <span className="sr-only">{t('state.loading')}</span>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }
  if (locked) {
    return (
      <EmptyState
        title={t('state.lockedTitle')}
        message={t('state.lockedBody')}
        actions={
          <Link
            href={PLAN_UPGRADE_PATH}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t('state.upgrade')}
          </Link>
        }
      />
    );
  }
  if (error) {
    return (
      <EmptyState
        title={t('state.errorTitle')}
        message={t('state.errorBody')}
        actions={
          <Button variant="secondary" onClick={onRetry}>
            {t('state.retry')}
          </Button>
        }
      />
    );
  }
  if (rows.length === 0) {
    return filtered ? (
      <EmptyState
        title={t('state.emptyFilteredTitle')}
        message={t('state.emptyFilteredBody')}
        actions={
          <Button variant="secondary" onClick={onClear}>
            {t('filters.clear')}
          </Button>
        }
      />
    ) : (
      <EmptyState
        title={t('state.emptyTitle')}
        message={t('state.emptyBody')}
        actions={
          <Link
            href={`/forms/${formId}?tab=share`}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t('state.emptyShare')}
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <SubmissionsTable rows={rows} onOpen={onOpen} />
      <SubmissionCards rows={rows} onOpen={onOpen} />
      {hasNext && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={onMore} disabled={loadingMore}>
            {loadingMore && <Spinner />}
            {loadingMore ? t('state.loadingMore') : t('state.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

function useWhen() {
  const format = useFormatter();
  return (iso: string) => {
    const d = new Date(iso);
    return {
      relative: format.relativeTime(d, new Date()),
      absolute: format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' }),
    };
  };
}

/** Name, email and phone as the visitor gave them. Email and phone read left to right in any language. */
function Preview({ s }: { s: FormSubmissionSummary }) {
  const t = useTranslations('web-forms.submissions');
  const { name, email, phone } = s.preview;
  return (
    <span className="block min-w-0 text-start">
      {name ? (
        <span className="block truncate font-medium" dir="auto">
          {name}
        </span>
      ) : !email && !phone ? (
        <span className="block truncate font-medium text-muted-foreground">{t('anonymous')}</span>
      ) : null}
      {email && (
        <span
          className={cn(
            'block truncate',
            name || phone ? 'text-xs text-muted-foreground' : 'font-medium',
          )}
          dir="ltr"
        >
          {email}
        </span>
      )}
      {phone && (
        <span className="block truncate text-xs text-muted-foreground" dir="ltr">
          {phone}
        </span>
      )}
    </span>
  );
}

function StatusCell({ s }: { s: FormSubmissionSummary }) {
  const t = useTranslations('web-forms.submissions');
  const key = reasonKey(s.reason);
  return (
    <div className="space-y-1">
      <Badge tone={statusTone(s.status)}>{t(`status.${s.status}`)}</Badge>
      {s.answersRemoved && (
        <div className="text-xs text-muted-foreground">{t('answersRemovedShort')}</div>
      )}
      {hasReason(s.status) && key && (
        <p className="max-w-xs text-xs text-muted-foreground" data-testid="reason">
          <span>{t(`reason.${key}.what`)}</span> <span>{t(`reason.${key}.todo`)}</span>
        </p>
      )}
    </div>
  );
}

function ContactLink({ s }: { s: FormSubmissionSummary }) {
  const t = useTranslations('web-forms.submissions');
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <>
      {s.contact ? (
        <Link
          href={`/contacts/${s.contact.id}`}
          onClick={stop}
          className="text-brand hover:underline"
          dir="auto"
        >
          {s.contact.name || t('unnamedContact')}
        </Link>
      ) : (
        <span className="text-muted-foreground">{t('noLink')}</span>
      )}
    </>
  );
}

function CompanyLink({ s }: { s: FormSubmissionSummary }) {
  const t = useTranslations('web-forms.submissions');
  return s.company ? (
    <Link
      href={`/companies/${s.company.id}`}
      onClick={(e) => e.stopPropagation()}
      className="text-brand hover:underline"
      dir="auto"
    >
      {s.company.name || t('unnamedCompany')}
    </Link>
  ) : (
    <span className="text-muted-foreground">{t('noLink')}</span>
  );
}

function SubmissionsTable({
  rows,
  onOpen,
}: {
  rows: FormSubmissionSummary[];
  onOpen: (id: string, opener: HTMLElement) => void;
}) {
  const t = useTranslations('web-forms.submissions');
  const when = useWhen();
  return (
    <div className="hidden overflow-x-auto rounded-md border border-border md:block">
      <table className="w-full text-sm" data-testid="submissions-table">
        <caption className="sr-only">{t('title')}</caption>
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            {(['received', 'visitor', 'status', 'contact', 'company', 'version'] as const).map(
              (c) => (
                <th key={c} scope="col" className="px-3 py-2 text-start font-medium">
                  {t(`table.${c}`)}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const w = when(s.createdAt);
            return (
              <tr
                key={s.id}
                onClick={(e) => {
                  const b = e.currentTarget.querySelector<HTMLElement>('button[data-row-open]');
                  if (b) onOpen(s.id, b);
                }}
                className="cursor-pointer border-t border-border align-top hover:bg-muted/50"
                data-testid="submission-row"
                data-status={s.status}
              >
                <td className="px-3 py-3 whitespace-nowrap">
                  <button
                    type="button"
                    data-row-open
                    aria-label={t('table.open', { who: whoOf(s, t('anonymous')) })}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(s.id, e.currentTarget);
                    }}
                    className="rounded text-start underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <time dateTime={s.createdAt} title={w.absolute}>
                      {w.relative}
                    </time>
                  </button>
                  <div className="text-xs text-muted-foreground">{w.absolute}</div>
                </td>
                <td className="px-3 py-3">
                  <Preview s={s} />
                </td>
                <td className="px-3 py-3">
                  <StatusCell s={s} />
                </td>
                <td className="px-3 py-3">
                  <ContactLink s={s} />
                </td>
                <td className="px-3 py-3">
                  <CompanyLink s={s} />
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                  {t('versionShort', { n: s.formVersion })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SubmissionCards({
  rows,
  onOpen,
}: {
  rows: FormSubmissionSummary[];
  onOpen: (id: string, opener: HTMLElement) => void;
}) {
  const t = useTranslations('web-forms.submissions');
  const when = useWhen();
  return (
    <ul className="space-y-3 md:hidden" data-testid="submission-cards">
      {rows.map((s) => {
        const w = when(s.createdAt);
        return (
          <li
            key={s.id}
            className="space-y-2 rounded-md border border-border bg-background p-3"
            data-testid="submission-card"
          >
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                data-row-open
                aria-label={t('table.open', { who: whoOf(s, t('anonymous')) })}
                onClick={(e) => onOpen(s.id, e.currentTarget)}
                className="min-w-0 flex-1 rounded text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Preview s={s} />
                <time
                  dateTime={s.createdAt}
                  title={w.absolute}
                  className="mt-1 block text-xs text-muted-foreground"
                >
                  {w.relative}
                </time>
              </button>
              <span className="text-xs text-muted-foreground">
                {t('versionShort', { n: s.formVersion })}
              </span>
            </div>
            <StatusCell s={s} />
            {(s.contact || s.company) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {s.contact && <ContactLink s={s} />}
                {s.company && <CompanyLink s={s} />}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One heading and its definition list inside the drawer. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className={cn('min-w-0 text-sm [overflow-wrap:anywhere]', className)}>{children}</dd>
    </div>
  );
}

/** Retry and delete answer with a code; the message is ours, in the person's language, never the server's text. */
function retryMessageKey(
  err: unknown,
): 'toast.notRetryable' | 'toast.purged' | 'toast.retryFailed' {
  if (err instanceof ApiError) {
    if (err.code === ERROR_CODES.FORMS_SUBMISSION_NOT_RETRYABLE) return 'toast.notRetryable';
    if (err.code === ERROR_CODES.FORMS_SUBMISSION_PURGED) return 'toast.purged';
  }
  return 'toast.retryFailed';
}

/**
 * The right-hand panel (the left in Arabic) with everything about one submission. It is a native modal dialog, so the browser traps
 * focus, Escape closes it and focus returns to where it came from. Every value is rendered as text, never as markup.
 */
export function SubmissionDrawer({
  formId,
  summary,
  onClose,
  onChanged,
}: {
  formId: string;
  summary: FormSubmissionSummary;
  onClose: () => void;
  onChanged: (submissionId?: string) => void;
}) {
  const t = useTranslations('web-forms.submissions');
  const format = useFormatter();
  const { toast } = useToast();
  const canUpdate = useCan(UPDATE_PERM);
  const canErase = useCan(DELETE_PERM);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const detail = useSubmission(formId, summary.id);
  const [busy, setBusy] = useState<'retry' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open && typeof el.showModal === 'function') el.showModal();
  }, []);

  // The list row is the freshest status; the detail carries the rest.
  const d: FormSubmissionDetail | undefined = detail.data;
  const status = summary.status;
  const removed = d?.answersRemoved ?? summary.answersRemoved;
  const key = reasonKey(summary.reason);
  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  const retry = async () => {
    setBusy('retry');
    try {
      const next = await retrySubmission(formId, summary.id);
      toast(t('toast.retried', { status: t(`status.${next.status}`) }), 'success');
      onChanged(summary.id);
    } catch (err) {
      toast(t(retryMessageKey(err)), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const erase = async () => {
    setBusy('delete');
    try {
      await deleteSubmission(formId, summary.id);
      toast(t('toast.deleted'), 'success');
      setConfirming(false);
      onChanged(summary.id);
      onClose();
    } catch {
      toast(t('toast.deleteFailed'), 'danger');
      setConfirming(false);
    } finally {
      setBusy(null);
    }
  };

  const showRetry = canUpdate && canRetry(status, removed);
  const showDelete = canErase && canDelete(removed);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-modal="true"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      className="fixed inset-y-0 m-0 ms-auto me-0 h-dvh max-h-none w-[min(36rem,100vw)] max-w-none flex-col border-0 border-s border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/40 open:flex"
      data-testid="submission-drawer"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0 space-y-2">
          <h2 id={titleId} className="text-lg font-semibold [overflow-wrap:anywhere]" dir="auto">
            {t('drawer.title', { who: whoOf(summary, t('anonymous')) })}
          </h2>
          <Badge tone={statusTone(status)}>{t(`status.${status}`)}</Badge>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 shrink-0 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {t('drawer.close')}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {hasReason(status) && key && (
          <Alert tone={status === 'failed' ? 'danger' : 'warning'} className="space-y-1">
            <p className="font-medium">{t(`reason.${key}.what`)}</p>
            <p>
              <span className="font-medium">{t('reason.todo')}: </span>
              {t(`reason.${key}.todo`)}
            </p>
          </Alert>
        )}

        {(showRetry || showDelete) && (
          <div className="flex flex-wrap gap-2" aria-label={t('drawer.actions')} role="group">
            {showRetry && (
              <Button onClick={() => void retry()} disabled={busy !== null} data-testid="retry">
                {busy === 'retry' && <Spinner />}
                {busy === 'retry'
                  ? t('actions.retrying')
                  : status === 'spam'
                    ? t('actions.notSpam')
                    : t('actions.retry')}
              </Button>
            )}
            {showDelete && (
              <Button
                variant="danger"
                onClick={() => setConfirming(true)}
                disabled={busy !== null}
                data-testid="delete"
              >
                {t('actions.delete')}
              </Button>
            )}
          </div>
        )}

        {detail.isPending ? (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {t('drawer.loading')}
          </div>
        ) : detail.isError || !d ? (
          <div className="space-y-2">
            <p className="font-medium">{t('drawer.errorTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('drawer.errorBody')}</p>
            <Button variant="secondary" onClick={() => void detail.refetch()}>
              {t('drawer.retryLoad')}
            </Button>
          </div>
        ) : (
          <>
            {d.answersRemoved ? (
              <Alert tone="info" data-testid="answers-removed" className="space-y-1">
                <p className="font-medium">{t('drawer.removedTitle')}</p>
                <p>{t('drawer.removedBody')}</p>
              </Alert>
            ) : (
              <Section title={t('drawer.answers')}>
                {d.answers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('drawer.noAnswers')}</p>
                ) : (
                  <dl className="space-y-3" data-testid="answers">
                    {d.answers.map((a) => {
                      const v = answerView(a.value);
                      return (
                        <Row key={a.fieldId} label={a.label} className="whitespace-pre-wrap">
                          {v.type === 'empty' ? (
                            <span className="text-muted-foreground">{t('drawer.emptyAnswer')}</span>
                          ) : v.type === 'boolean' ? (
                            t(v.value ? 'drawer.yes' : 'drawer.no')
                          ) : (
                            v.text
                          )}
                        </Row>
                      );
                    })}
                  </dl>
                )}
              </Section>
            )}

            <Section title={t('drawer.summary')}>
              <dl className="space-y-2">
                <Row label={t('drawer.receivedAt')}>{dateTime(d.createdAt)}</Row>
                <Row label={t('drawer.formVersion')}>{t('versionShort', { n: d.formVersion })}</Row>
                <Row label={t('drawer.spamScore')}>{d.spamScore}</Row>
                {d.error && <Row label={t('drawer.error')}>{d.error}</Row>}
              </dl>
            </Section>

            <Section title={t('drawer.links')}>
              <dl className="space-y-2">
                <Row label={t('table.contact')}>
                  <ContactLink s={d} />
                </Row>
                <Row label={t('table.company')}>
                  <CompanyLink s={d} />
                </Row>
              </dl>
            </Section>

            <Section title={t('drawer.attribution')}>
              {Object.keys(d.attribution.utm).length === 0 &&
              !d.attribution.referrer &&
              !d.attribution.pageUrl &&
              !d.attribution.userAgent ? (
                <p className="text-sm text-muted-foreground">{t('drawer.noAttribution')}</p>
              ) : (
                <dl className="space-y-2" data-testid="attribution">
                  {Object.entries(d.attribution.utm).map(([k, v]) => (
                    <Row key={k} label={`${t('drawer.utm')} (${k})`}>
                      <span dir="ltr">{v}</span>
                    </Row>
                  ))}
                  {d.attribution.referrer && (
                    <Row label={t('drawer.referrer')}>
                      <span dir="ltr">{d.attribution.referrer}</span>
                    </Row>
                  )}
                  {d.attribution.pageUrl && (
                    <Row label={t('drawer.pageUrl')}>
                      <span dir="ltr">{d.attribution.pageUrl}</span>
                    </Row>
                  )}
                  {d.attribution.userAgent && (
                    <Row label={t('drawer.userAgent')}>
                      <span dir="ltr">{d.attribution.userAgent}</span>
                    </Row>
                  )}
                </dl>
              )}
            </Section>

            <Section title={t('drawer.consent')}>
              {d.consent ? (
                <dl className="space-y-2" data-testid="consent">
                  <Row label={t('drawer.consentGiven')}>
                    {t(d.consent.given ? 'drawer.yes' : 'drawer.no')}
                  </Row>
                  <Row label={t('drawer.consentText')} className="whitespace-pre-wrap">
                    {d.consent.text}
                  </Row>
                  <Row label={t('drawer.consentVersion')}>{d.consent.version}</Row>
                  <Row label={t('drawer.consentAt')}>{dateTime(d.consent.at)}</Row>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">{t('drawer.noConsent')}</p>
              )}
            </Section>
          </>
        )}

        <p className="text-xs text-muted-foreground">{t('drawer.auditNote')}</p>
      </div>

      <ConfirmDialog
        open={confirming}
        tone="danger"
        busy={busy === 'delete'}
        title={t('confirmDelete.title')}
        message={t('confirmDelete.message')}
        confirmLabel={busy === 'delete' ? t('actions.deleting') : t('confirmDelete.confirm')}
        cancelLabel={t('confirmDelete.cancel')}
        onConfirm={() => void erase()}
        onClose={() => setConfirming(false)}
      />
    </dialog>
  );
}
