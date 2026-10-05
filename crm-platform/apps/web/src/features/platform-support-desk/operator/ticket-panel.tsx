'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SUPP_TICKET_PRIORITIES,
  SUPP_TICKET_STATUSES,
  operatorTicketDetailSchema,
  runnablePlaybooksResponseSchema,
  ticketAssigneesResponseSchema,
  type OperatorTicketDetail,
  type SlaTimer,
} from '@crm/contracts';
import { Alert, Badge, Button, Checkbox, Select, Spinner, Textarea, cn } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { INBOX_KEY, PRIORITY_PILL, STATUS_PILL, errorKey, formatWhen } from '../lib/display';

const NS = 'platform-support-desk';

const SLA_TONE = { ok: 'success', met: 'success', warn: 'warning', breach: 'danger' } as const;

/** The slide-in ticket panel: quick-action pills, assignment, the whole thread and the reply box. */
export function TicketPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations(`${NS}.operator.panel`);
  const tt = useTranslations(`${NS}.operator.toast`);
  const te = useTranslations(`${NS}.errors`);
  const ts = useTranslations(`${NS}.status`);
  const tp = useTranslations(`${NS}.priority`);
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { operator } = useOperator();
  const canWrite = operator.role !== 'auditor';
  const key = ['support', 'operator', 'ticket', id] as const;
  const [body, setBody] = useState('');
  const [note, setNote] = useState(false);
  const [playbookId, setPlaybookId] = useState('');
  const [pickedAssignee, setPickedAssignee] = useState<string | null>(null);

  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      operatorFetch(`/support/tickets/${id}`, { schema: operatorTicketDetailSchema, signal }),
  });
  const assignees = useQuery({
    queryKey: ['support', 'operator', 'assignees'],
    queryFn: ({ signal }) =>
      operatorFetch('/support/tickets/assignees', {
        schema: ticketAssigneesResponseSchema,
        signal,
      }),
    enabled: canWrite,
  });

  const playbooks = useQuery({
    queryKey: ['support', 'operator', 'runnable'],
    queryFn: ({ signal }) =>
      operatorFetch('/support/playbooks/runnable', {
        schema: runnablePlaybooksResponseSchema,
        signal,
      }),
    enabled: canWrite,
  });

  const done = (d: OperatorTicketDetail, message: string) => {
    qc.setQueryData(key, d);
    setPickedAssignee(null);
    void qc.invalidateQueries({ queryKey: INBOX_KEY });
    toast.success(message);
  };
  const failed = (e: unknown) => {
    toast.error(te(errorKey(e)));
    // A stale version means someone else changed the ticket: show theirs.
    if (e instanceof ApiError && e.isRowVersionConflict) void q.refetch();
  };

  const patch = useMutation({
    mutationFn: (v: { path: string; body: Record<string, unknown>; ok: string }) =>
      operatorFetch(`/support/tickets/${id}/${v.path}`, {
        method: 'PATCH',
        body: { ...v.body, rowVersion: q.data!.rowVersion },
        schema: operatorTicketDetailSchema,
      }),
    onSuccess: (d, v) => done(d, v.ok),
    onError: failed,
  });

  const runPlaybook = useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      operatorFetch(`/support/tickets/${id}/playbooks/${v.id}/run`, {
        method: 'POST',
        schema: operatorTicketDetailSchema,
      }),
    onSuccess: (d, v) => {
      setPlaybookId('');
      void qc.invalidateQueries({ queryKey: ['support', 'operator', 'playbooks'] });
      done(d, tt('playbook', { name: v.name }));
    },
    onError: failed,
  });

  const reply = useMutation({
    mutationFn: (v: { text: string; internal: boolean }) =>
      operatorFetch(`/support/tickets/${id}/reply`, {
        method: 'POST',
        body: { body: v.text, isInternalNote: v.internal },
        schema: operatorTicketDetailSchema,
      }),
    onSuccess: (d, v) => {
      setBody('');
      setNote(false);
      const last = d.messages[d.messages.length - 1];
      done(
        d,
        v.internal
          ? tt('noted')
          : last?.emailStatus === 'failed'
            ? tt('emailFailed')
            : tt('replied', { email: d.customerEmail }),
      );
    },
    onError: failed,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (body.trim()) reply.mutate({ text: body, internal: note });
  };

  const d = q.data;
  const assigneeId = pickedAssignee ?? d?.assignee?.id ?? '';
  const setAssigneeId = setPickedAssignee;
  const busy = patch.isPending || reply.isPending;

  return (
    <aside
      role="dialog"
      aria-label={d ? t('title', { number: d.ticketNumber }) : t('loading')}
      className="fixed inset-y-0 end-0 z-40 flex w-full max-w-[520px] flex-col border-s border-border bg-background shadow-xl"
    >
      <header className="flex items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">
            {d ? t('title', { number: d.ticketNumber }) : t('loading')}
          </p>
          <h2 className="truncate text-lg font-semibold">{d?.subject}</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('close')}
        </Button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {q.isPending && <Spinner />}
        {q.isError && <Alert tone="danger">{te(errorKey(q.error))}</Alert>}
        {d && (
          <>
            {!canWrite && <Alert>{t('readOnly')}</Alert>}
            <div className="space-y-3">
              <Pills
                values={SUPP_TICKET_STATUSES}
                current={d.status}
                text={ts}
                tint={STATUS_PILL}
                disabled={!canWrite || busy}
                onPick={(status) =>
                  patch.mutate({ path: 'status', body: { status }, ok: tt('status') })
                }
              />
              <Pills
                label={t('priority')}
                mono
                values={SUPP_TICKET_PRIORITIES}
                current={d.priority}
                text={tp}
                tint={PRIORITY_PILL}
                disabled={!canWrite || busy}
                onPick={(priority) =>
                  patch.mutate({ path: 'priority', body: { priority }, ok: tt('priority') })
                }
              />
              <form
                className="flex items-center gap-2 text-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (assigneeId === (d.assignee?.id ?? '')) return;
                  patch.mutate({
                    path: 'assignee',
                    body: { agentId: assigneeId || null },
                    ok: assigneeId ? tt('assigned') : tt('unassigned'),
                  });
                }}
              >
                <label htmlFor="tp-assign" className="shrink-0 text-xs text-muted-foreground">
                  {t('assign')}
                </label>
                <Select
                  id="tp-assign"
                  value={assigneeId}
                  disabled={!canWrite || busy}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  <option value="">{t('unassign')}</option>
                  {assignees.data?.data.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
                {canWrite && (
                  <Button type="submit" size="sm" disabled={busy}>
                    {t('assignSave')}
                  </Button>
                )}
              </form>
            </div>

            {canWrite && (playbooks.data?.data.length ?? 0) > 0 && (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const pb = playbooks.data?.data.find((p) => p.id === playbookId);
                  if (pb) runPlaybook.mutate({ id: pb.id, name: pb.name });
                }}
              >
                <span className="shrink-0 text-sm font-medium">{t('runPlaybook')}</span>
                <Select
                  aria-label={t('runPlaybook')}
                  value={playbookId}
                  disabled={busy || runPlaybook.isPending}
                  onChange={(e) => setPlaybookId(e.target.value)}
                >
                  <option value="">{t('pickPlaybook')}</option>
                  {playbooks.data?.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={!playbookId || busy || runPlaybook.isPending}
                >
                  {t('run')}
                </Button>
              </form>
            )}

            <dl
              className="grid grid-cols-2 gap-1 border-t pt-3 font-mono text-xs"
              data-testid="sla"
            >
              <dt className="text-muted-foreground">{t('slaFirst')}</dt>
              <dd>
                <SlaPill timer={d.sla.firstResponse} policy={d.sla.policy !== null} />
              </dd>
              <dt className="text-muted-foreground">{t('slaResolution')}</dt>
              <dd>
                <SlaPill timer={d.sla.resolution} policy={d.sla.policy !== null} />
              </dd>
            </dl>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-b pb-3 text-sm">
              <Meta label={t('status')}>{ts(d.status)}</Meta>
              <Meta label={t('priority')}>{tp(d.priority)}</Meta>
              <Meta label={t('customer')}>{d.customerName || d.customerEmail}</Meta>
              <Meta label={t('workspace')}>{d.workspace.name}</Meta>
              <Meta label={t('assignedTo')}>{d.assignee?.name ?? t('none')}</Meta>
              <Meta label={t('firstReply')}>
                {d.firstResponseAt ? formatWhen(d.firstResponseAt, locale) : '—'}
              </Meta>
              <Meta label={t('opened')}>{formatWhen(d.createdAt, locale)}</Meta>
            </dl>

            <ol className="space-y-2" data-testid="thread">
              <Bubble who={t('customerInitial')}>{d.message}</Bubble>
              {d.messages.map((m) => (
                <Bubble
                  key={m.id}
                  admin={m.role === 'admin'}
                  who={`${m.authorName} · ${m.role} · ${formatWhen(m.createdAt, locale)}`}
                  badges={
                    <>
                      {m.isInternalNote && <Badge tone="warning">{t('internal')}</Badge>}
                      {m.emailStatus === 'failed' && (
                        <Badge tone="danger">{t('emailFailed')}</Badge>
                      )}
                    </>
                  }
                >
                  {m.body}
                </Bubble>
              ))}
            </ol>
          </>
        )}
      </div>

      {d && canWrite && (
        <form onSubmit={submit} className="space-y-2 border-t p-4">
          <Textarea
            aria-label={t('replyPlaceholder')}
            rows={3}
            maxLength={8000}
            value={body}
            placeholder={t('replyPlaceholder')}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            <Checkbox
              label={t('internalNote')}
              checked={note}
              onChange={(e) => setNote(e.target.checked)}
            />
            <Button type="submit" disabled={busy || !body.trim()}>
              {reply.isPending ? t('sending') : note ? t('addNote') : t('send')}
            </Button>
          </div>
        </form>
      )}
    </aside>
  );
}

/** "12m left", "8m over", "met" or "no policy" (WD-SUPP-014). */
function SlaPill({ timer, policy }: { timer: SlaTimer | null; policy: boolean }) {
  const t = useTranslations(`${NS}.operator.panel`);
  if (!timer || !policy) return <span className="text-muted-foreground">{t('noPolicy')}</span>;
  const text =
    timer.severity === 'met'
      ? t('met')
      : timer.breached
        ? t('over', { n: timer.minutesOver ?? 0 })
        : t('left', { n: timer.minutesRemaining ?? 0 });
  return <Badge tone={SLA_TONE[timer.severity]}>{text}</Badge>;
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-1">
      <dt className="text-xs text-muted-foreground">{label}:</dt>
      <dd className="text-xs">{children}</dd>
    </div>
  );
}

function Pills<T extends string>({
  label,
  mono,
  values,
  current,
  text,
  tint,
  disabled,
  onPick,
}: {
  label?: string;
  mono?: boolean;
  values: readonly T[];
  current: T;
  text: (v: T) => string;
  tint: Record<string, string>;
  disabled: boolean;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {label && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}:
        </span>
      )}
      {values.map((v) => (
        <button
          key={v}
          type="button"
          disabled={disabled || v === current}
          aria-pressed={v === current}
          onClick={() => onPick(v)}
          className={cn(
            'rounded-full px-2.5 py-0.5 text-[11px]',
            mono ? 'font-mono text-[10px] uppercase' : 'lowercase',
            tint[v],
            v === current && 'ring-2 ring-primary',
            'disabled:cursor-not-allowed',
          )}
        >
          {text(v)}
        </button>
      ))}
    </div>
  );
}

function Bubble({
  who,
  admin,
  badges,
  children,
}: {
  who: string;
  admin?: boolean;
  badges?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        'rounded-md border p-3',
        admin ? 'border-primary/40 bg-primary/5' : 'border-border',
      )}
    >
      <p className="mb-1 flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
        {who}
        {badges}
      </p>
      <p className="whitespace-pre-wrap text-sm">{children}</p>
    </li>
  );
}
