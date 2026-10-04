'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  NOTE_SEVERITIES,
  SUPP_INBOX_TABS,
  WORKSPACE_FLAGS,
  inboxAuditResponseSchema,
  inboxBootstrapSchema,
  inboxConversationSchema,
  inboxQueueResponseSchema,
  type InboxBootstrap,
  type InboxQueueResponse,
} from '@crm/contracts';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Modal,
  Select,
  StatTile,
  Textarea,
  cn,
} from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { relativeTime, shortDate } from '../lib/format';

const NS = 'platform-support-desk.inbox';
const BOOT = ['support', 'inbox', 'bootstrap'] as const;
const QUEUE = ['support', 'inbox', 'queue'] as const;
const AUDIT = ['support', 'inbox', 'audit'] as const;
type Tab = (typeof SUPP_INBOX_TABS)[number];

/** Platform inbox (TW-SUPP-037..046): cross-workspace queue, drawer, audit feed, flags, suspension, impersonation launcher. */
export function PlatformInboxPage() {
  const t = useTranslations(NS);
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>('sla_breach');
  const [workspaceId, setWorkspaceId] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const boot = useQuery({
    queryKey: BOOT,
    queryFn: ({ signal }) =>
      operatorFetch('/inbox/bootstrap', { schema: inboxBootstrapSchema, signal }),
  });
  const can = (key: string) => boot.data?.permissions[key] === true;

  const queue = useInfiniteQuery({
    queryKey: [...QUEUE, tab, workspaceId],
    enabled: boot.isSuccess && can('platform.conversation.view_all'),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      operatorFetch('/inbox/queue', {
        query: { tab, workspaceId, cursor: pageParam, limit: 30 },
        schema: inboxQueueResponseSchema,
        signal,
      }),
    getNextPageParam: (last: InboxQueueResponse) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  const audit = useQuery({
    queryKey: AUDIT,
    enabled: boot.isSuccess && can('platform.audit.view'),
    queryFn: ({ signal }) =>
      operatorFetch('/inbox/audit', {
        query: { limit: 50 },
        schema: inboxAuditResponseSchema,
        signal,
      }),
  });

  const items = queue.data?.pages.flatMap((p) => p.data) ?? [];
  const total = queue.data?.pages[0]?.total;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('subtitle')}
        actions={
          <a href="#audit">
            <Button variant="secondary">{t('auditLink')}</Button>
          </a>
        }
      />
      {boot.isPending && <LoadingBlock />}
      {boot.isError && <ErrorBlock error={boot.error} onRetry={() => void boot.refetch()} />}
      {boot.data && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={t('kpi.workspaces')}
              value={boot.data.kpis.workspaces}
              hint={t('kpi.workspacesHint')}
            />
            <StatTile
              label={t('kpi.breach')}
              value={boot.data.kpis.breachTotal}
              hint={t('kpi.breachHint')}
              tone="warning"
            />
            <StatTile
              label={t('kpi.open')}
              value={boot.data.kpis.openTotal}
              hint={t('kpi.openHint')}
            />
            <StatTile
              label={t('kpi.impersonation')}
              value={t('kpi.none')}
              hint={t('kpi.noSession')}
            />
          </section>
          <section className="grid items-start gap-5 lg:grid-cols-3">
            <Card className="min-w-0 p-0 lg:col-span-2">
              <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {t('conversations')}
                </span>
                <div className="flex items-center gap-1" role="tablist">
                  {SUPP_INBOX_TABS.map((k) => (
                    <button
                      key={k}
                      role="tab"
                      aria-selected={tab === k}
                      onClick={() => setTab(k)}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-medium',
                        tab === k ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                      )}
                    >
                      {t(`tabs.${k}`)}
                    </button>
                  ))}
                </div>
                <Select
                  aria-label={t('allWorkspaces')}
                  className="ms-auto h-8 w-auto text-xs"
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                >
                  <option value="">{t('allWorkspaces')}</option>
                  {boot.data.workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="max-h-[60vh] overflow-y-auto">
                {!can('platform.conversation.view_all') && (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    {t('toast.forbidden')}
                  </p>
                )}
                {queue.isPending && can('platform.conversation.view_all') && <LoadingBlock />}
                {queue.isError && (
                  <ErrorBlock error={queue.error} onRetry={() => void queue.refetch()} />
                )}
                {queue.data && items.length === 0 && (
                  <p className="p-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
                )}
                <ul className="divide-y">
                  {items.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setOpenId(c.id)}
                        className="block w-full px-5 py-3 text-start hover:bg-muted"
                        data-testid="queue-row"
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">
                            {c.title || t('untitled')}
                          </span>
                          {c.slaBreached && <Badge tone="danger">{t('sla')}</Badge>}
                          {c.isSpam && <Badge>{t('spamChip')}</Badge>}
                          <span className="ms-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                            {c.lastMessageAt ? shortDate(c.lastMessageAt, locale).day : ''}
                          </span>
                        </div>
                        {c.preview && (
                          <p className="truncate text-xs text-muted-foreground">{c.preview}</p>
                        )}
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {c.workspaceName} · {c.assigneeName ?? t('unassignedWord')} ·{' '}
                          {c.teamName ?? '—'}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
                {queue.hasNextPage && (
                  <div className="p-3 text-center">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={queue.isFetchingNextPage}
                      onClick={() => void queue.fetchNextPage()}
                    >
                      {t('loadMore')}
                    </Button>
                  </div>
                )}
              </div>
              {total !== undefined && (
                <p className="border-t px-5 py-2 text-xs text-muted-foreground">
                  {t('total', { n: total })}
                </p>
              )}
            </Card>
            <Card className="p-0">
              <div className="border-b px-5 py-3">
                <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {t('workspaces')}
                </p>
                <h2 className="text-lg font-semibold">{t('recent')}</h2>
              </div>
              <ul className="max-h-[55vh] divide-y overflow-y-auto">
                {boot.data.workspaces.slice(0, 30).map((w) => (
                  <li key={w.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{w.name}</span>
                      {w.status !== 'active' && <Badge tone="danger">{t('suspended')}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {w.slug} · {w.plan}
                    </p>
                    <p className="mt-1 flex gap-3 text-xs">
                      <span>{t('openCount', { n: w.openCount })}</span>
                      {w.breachCount > 0 && (
                        <span className="text-danger">
                          {t('breachCount', { n: w.breachCount })}
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
          <Card id="audit" className="p-0">
            <div className="border-b px-5 py-3">
              <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {t('auditLink')}
              </p>
              <h2 className="text-lg font-semibold">{t('audit')}</h2>
            </div>
            <ul className="max-h-[40vh] divide-y overflow-y-auto">
              {audit.data?.data.length === 0 && (
                <li className="p-6 text-center text-sm text-muted-foreground">{t('auditEmpty')}</li>
              )}
              {!can('platform.audit.view') && (
                <li className="p-6 text-center text-sm text-muted-foreground">{t('auditEmpty')}</li>
              )}
              {audit.data?.data.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-2 text-xs">
                  <span className="font-mono">{e.action}</span>
                  <span className="text-muted-foreground">{e.workspaceName ?? '—'}</span>
                  <span className="ms-auto text-muted-foreground">
                    {relativeTime(e.at, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      {openId && boot.data && (
        <ConversationDrawer id={openId} boot={boot.data} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function ConversationDrawer({
  id,
  boot,
  onClose,
}: {
  id: string;
  boot: InboxBootstrap;
  onClose: () => void;
}) {
  const t = useTranslations(NS);
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['support', 'inbox', 'conversation', id] as const;
  const [note, setNote] = useState('');
  const [severity, setSeverity] = useState<(typeof NOTE_SEVERITIES)[number]>('info');
  const [confirmSpam, setConfirmSpam] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [reason, setReason] = useState('');
  const [flag, setFlag] = useState<(typeof WORKSPACE_FLAGS)[number]>('spam');
  const [flagReason, setFlagReason] = useState('');
  const perm = (k: string) => boot.permissions[k] === true;

  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      operatorFetch(`/inbox/conversations/${id}`, { schema: inboxConversationSchema, signal }),
  });
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: QUEUE });
    void qc.invalidateQueries({ queryKey: BOOT });
    void qc.invalidateQueries({ queryKey: AUDIT });
  };
  const fail = (e: unknown) =>
    toast.error(
      e instanceof ApiError && e.status === 403 ? t('toast.forbidden') : t('toast.failed'),
    );
  const run = (
    path: string,
    init: { method?: 'POST' | 'DELETE'; body?: unknown },
    ok: string,
    after?: () => void,
  ) =>
    operatorFetch(path, init).then(() => {
      toast.success(ok);
      refreshAll();
      after?.();
    }, fail);

  const addNote = useMutation({
    mutationFn: () =>
      operatorFetch(`/inbox/conversations/${id}/notes`, {
        method: 'POST',
        body: { body: note, severity },
      }),
    onSuccess: () => {
      toast.success(t('toast.noted'));
      setNote('');
      refreshAll();
    },
    onError: fail,
  });
  const impersonate = useMutation({
    mutationFn: () =>
      operatorFetch(`/inbox/workspaces/${q.data!.conversation.workspaceId}/impersonate`, {
        method: 'POST',
        body: { reason },
      }),
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.status === 501
          ? t('impersonation.unavailable')
          : t('toast.failed'),
      ),
  });

  const d = q.data;
  const ws = d && boot.workspaces.find((w) => w.id === d.conversation.workspaceId);
  const submitImpersonation = () => {
    if (reason.trim().length < 8) return toast.error(t('impersonation.short'));
    impersonate.mutate();
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={t('drawer.conversation')}
        className="absolute inset-y-0 end-0 flex w-full max-w-[640px] flex-col bg-background shadow-xl"
      >
        <header className="flex items-center gap-3 border-b px-5 py-4">
          <Button variant="ghost" size="sm" aria-label={t('drawer.close')} onClick={onClose}>
            ×
          </Button>
          <div className="min-w-0">
            <p className="truncate font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              {d?.conversation.workspaceName}
            </p>
            <h2 className="truncate text-lg font-semibold">
              {d?.conversation.title ?? t('drawer.conversation')}
            </h2>
          </div>
          <div className="ms-auto flex items-center gap-2">
            {perm('platform.workspace.impersonate') && (
              <Button size="sm" disabled={!d} onClick={() => setImpersonating(true)}>
                {t('drawer.impersonate')}
              </Button>
            )}
            {perm('platform.conversation.flag_spam') && (
              <Button
                size="sm"
                variant="danger"
                disabled={!d || d.conversation.isSpam}
                onClick={() => setConfirmSpam(true)}
              >
                {t('drawer.markSpam')}
              </Button>
            )}
          </div>
        </header>
        <div className="flex-1 divide-y overflow-y-auto">
          {q.isPending && <LoadingBlock />}
          {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
          {d && (
            <>
              <Section title={t('drawer.thread')}>
                {d.messages.length === 0 && <Muted>{t('drawer.noMessages')}</Muted>}
                {d.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      'max-w-[85%] rounded-md border p-2 text-sm',
                      m.direction === 'out' ? 'ms-auto bg-primary/10' : 'bg-muted/40',
                    )}
                  >
                    <p className="whitespace-pre-wrap">{m.body ?? `[${m.kind}]`}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {m.direction} · {relativeTime(m.createdAt, locale)}
                    </p>
                  </div>
                ))}
              </Section>
              <Section title={t('drawer.platformNotes')}>
                {d.platformNotes.map((n) => (
                  <div key={n.id} className="rounded-md border p-2 text-sm">
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <p className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                      <Badge
                        tone={
                          n.severity === 'critical'
                            ? 'danger'
                            : n.severity === 'warn'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {t(`severity.${n.severity}`)}
                      </Badge>
                      {n.adminName} · {relativeTime(n.createdAt, locale)}
                    </p>
                  </div>
                ))}
                {perm('platform.note.write') && (
                  <div className="space-y-2">
                    <Textarea
                      rows={2}
                      maxLength={8000}
                      aria-label={t('drawer.noteHint')}
                      placeholder={t('drawer.noteHint')}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                      <Select
                        aria-label={t('drawer.severity')}
                        className="h-8 w-auto text-xs"
                        value={severity}
                        onChange={(e) => setSeverity(e.target.value as typeof severity)}
                      >
                        {NOTE_SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {t(`severity.${s}`)}
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        className="ms-auto"
                        disabled={!note.trim() || addNote.isPending}
                        onClick={() => addNote.mutate()}
                      >
                        {t('drawer.addNote')}
                      </Button>
                    </div>
                  </div>
                )}
              </Section>
              <Section title={t('drawer.workspaceNotes')}>
                {d.notes.length === 0 && <Muted>{t('drawer.noNotes')}</Muted>}
                {d.notes.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-md border border-warning/40 bg-warning/5 p-2 text-sm"
                  >
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {n.authorName ?? '—'} · {relativeTime(n.createdAt, locale)}
                    </p>
                  </div>
                ))}
              </Section>
              <Section title={t('flags.title')}>
                <div className="flex flex-wrap gap-2">
                  {ws?.flags.map((f) => (
                    <Badge
                      key={f.id}
                      tone={
                        ['frozen', 'fraud', 'tos_violation'].includes(f.flag) ? 'danger' : 'warning'
                      }
                    >
                      {t(`flags.names.${f.flag}`)}
                      {perm('platform.workspace.unflag') && (
                        <button
                          type="button"
                          className="ms-1 underline"
                          onClick={() =>
                            void run(
                              `/inbox/flags/${f.id}`,
                              { method: 'DELETE' },
                              t('toast.cleared'),
                            )
                          }
                        >
                          {t('flags.clear')}
                        </button>
                      )}
                    </Badge>
                  ))}
                </div>
                {perm('platform.workspace.flag') && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      aria-label={t('flags.flag')}
                      className="h-8 w-auto text-xs"
                      value={flag}
                      onChange={(e) => setFlag(e.target.value as typeof flag)}
                    >
                      {WORKSPACE_FLAGS.map((f) => (
                        <option key={f} value={f}>
                          {t(`flags.names.${f}`)}
                        </option>
                      ))}
                    </Select>
                    <Input
                      aria-label={t('flags.reason')}
                      placeholder={t('flags.reason')}
                      maxLength={500}
                      className="h-8 min-w-0 flex-1 text-xs"
                      value={flagReason}
                      onChange={(e) => setFlagReason(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void run(
                          `/inbox/workspaces/${d.conversation.workspaceId}/flags`,
                          { method: 'POST', body: { flag, reason: flagReason || undefined } },
                          t('toast.flagged'),
                          () => setFlagReason(''),
                        )
                      }
                    >
                      {t('flags.add')}
                    </Button>
                  </div>
                )}
                <div className="flex gap-2">
                  {ws?.status === 'active' && perm('platform.workspace.suspend') && (
                    <Button size="sm" variant="danger" onClick={() => setConfirmSuspend(true)}>
                      {t('flags.suspend')}
                    </Button>
                  )}
                  {ws?.status !== 'active' && perm('platform.workspace.unsuspend') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void run(
                          `/inbox/workspaces/${d.conversation.workspaceId}/unsuspend`,
                          { method: 'POST' },
                          t('toast.unsuspended'),
                        )
                      }
                    >
                      {t('flags.unsuspend')}
                    </Button>
                  )}
                </div>
              </Section>
              <Section title={t('drawer.events')}>
                {d.events.length === 0 && <Muted>{t('drawer.noEvents')}</Muted>}
                {d.events.map((e, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {e.type} · {relativeTime(e.createdAt, locale)}
                  </p>
                ))}
              </Section>
            </>
          )}
        </div>
      </aside>
      <ConfirmDialog
        open={confirmSpam}
        title={t('drawer.spamTitle')}
        message={t('drawer.spamConfirm')}
        confirmLabel={t('drawer.markSpam')}
        cancelLabel={t('impersonation.cancel')}
        tone="danger"
        onConfirm={() => {
          setConfirmSpam(false);
          void run(`/inbox/conversations/${id}/spam`, { method: 'POST' }, t('toast.spam'), onClose);
        }}
        onClose={() => setConfirmSpam(false)}
      />
      <ConfirmDialog
        open={confirmSuspend}
        title={t('flags.suspendTitle')}
        message={t('flags.suspendConfirm')}
        confirmLabel={t('flags.suspend')}
        cancelLabel={t('impersonation.cancel')}
        tone="danger"
        onConfirm={() => {
          setConfirmSuspend(false);
          void run(
            `/inbox/workspaces/${d!.conversation.workspaceId}/suspend`,
            { method: 'POST', body: {} },
            t('toast.suspended'),
          );
        }}
        onClose={() => setConfirmSuspend(false)}
      />
      <Modal
        open={impersonating}
        onClose={() => setImpersonating(false)}
        title={t('impersonation.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setImpersonating(false)}>
              {t('impersonation.cancel')}
            </Button>
            <Button disabled={impersonate.isPending} onClick={submitImpersonation}>
              {t('impersonation.start')}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">{t('impersonation.body')}</p>
        <Textarea
          rows={3}
          maxLength={500}
          aria-label={t('impersonation.reason')}
          placeholder={t('impersonation.reason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 px-5 py-3">
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}
const Muted = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-muted-foreground">{children}</p>
);
