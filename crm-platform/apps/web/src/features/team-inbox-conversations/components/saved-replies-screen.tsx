'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useDeferredValue, useMemo, useState } from 'react';
import { PLAN_UPGRADE_PATH, isUnlimitedLimit, type SavedReply } from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Select,
  Spinner,
  cn,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { refreshSavedReplies, savedRepliesApi, useSavedReplyList } from '../api/saved-replies';
import { useErrorText } from './parts';
import { SavedReplyForm } from './saved-reply-form';
import { ExportRepliesButton, ImportRepliesButton } from './saved-replies-transfer';

type Tab = 'all' | 'shared' | 'mine';
const TABS: readonly Tab[] = ['all', 'shared', 'mine'];
/** From this share of the plan's cap on, the meter warns. */
const NEAR_LIMIT = 0.8;

/**
 * `/inbox/saved-replies` (Settings > Data and customization > Saved replies): the workspace's library of reusable replies, shared and
 * personal, with a plan meter. Opening it needs `inbox.savedreply.manage`; each row's buttons follow what the server says the caller may
 * change (`canEdit`). Agents insert replies from the inbox composer (type `/`), not from here.
 */
export function SavedRepliesScreen() {
  const t = useTranslations('team-inbox-conversations.savedReplies.screen');
  const canManage = useCan('inbox.savedreply.manage');
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const q = useDeferredValue(search.trim());
  const list = useSavedReplyList({ scope: tab, q, category }, canManage);
  const [editing, setEditing] = useState<SavedReply | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SavedReply | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const first = list.data?.pages[0];
  const counts = first?.counts;
  // An unlimited plan (0, or the 1,000,000 stand-in) has no cap to meter.
  const rawLimit = first?.limit ?? null;
  const limit = rawLimit !== null && !isUnlimitedLimit(rawLimit) ? rawLimit : null;
  const total = first?.total ?? 0;
  const atLimit = limit !== null && total >= limit;
  const nearLimit = limit !== null && !atLimit && total >= limit * NEAR_LIMIT;

  async function run(id: string, action: () => Promise<unknown>) {
    setBusy(id);
    try {
      await action();
      await refreshSavedReplies(qc);
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setBusy(null);
    }
  }

  if (!canManage) {
    return (
      <section className="mx-auto max-w-4xl">
        <Alert tone="warning">{t('noAccess')}</Alert>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/settings/data"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← {t('back')}
          </Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportRepliesButton />
          <ImportRepliesButton disabled={atLimit} />
          <Button
            onClick={() => setEditing('new')}
            disabled={atLimit}
            data-testid="saved-reply-new"
          >
            {t('create')}
          </Button>
        </div>
      </header>

      {limit !== null && (
        <div
          data-testid="saved-reply-meter"
          className="space-y-2 rounded-xl border border-border bg-background p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">{t('meter', { used: total, limit })}</span>
            {(atLimit || nearLimit) && (
              <Link href={PLAN_UPGRADE_PATH} className="font-semibold underline">
                {t('upgrade')}
              </Link>
            )}
          </div>
          <div
            role="progressbar"
            aria-label={t('meterLabel')}
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-valuenow={Math.min(total, limit)}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                'h-full rounded-full',
                atLimit ? 'bg-danger' : nearLimit ? 'bg-warning' : 'bg-primary',
              )}
              style={{ width: `${Math.min(100, (total / limit) * 100)}%` }}
            />
          </div>
          {atLimit && <p className="text-xs text-danger">{t('atLimit', { limit })}</p>}
          {nearLimit && <p className="text-xs text-warning">{t('nearLimit', { limit })}</p>}
          <p className="text-xs text-muted-foreground">{t('meterNote')}</p>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label={t('tabsLabel')} className="flex gap-1">
            {TABS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                data-testid={`saved-reply-tab-${id}`}
                onClick={() => setTab(id)}
                className={cn(
                  'rounded-full px-3 py-1 text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary',
                  tab === id
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {t(`tab.${id}`, { count: counts?.[id] ?? 0 })}
              </button>
            ))}
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {(first?.categories.length ?? 0) > 0 && (
              <Select
                aria-label={t('categoryFilter')}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="sm:w-48"
              >
                <option value="">{t('allCategories')}</option>
                {first?.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
            <div className="w-full sm:w-72">
              <Input
                type="search"
                value={search}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchLabel')}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{t('howItWorks')}</p>

        {list.isPending ? (
          <div className="flex justify-center p-10" role="status" aria-label={t('loading')}>
            <Spinner />
          </div>
        ) : list.isError ? (
          <Alert tone="danger">
            {t('loadFailed')}{' '}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => void list.refetch()}
            >
              {t('retry')}
            </button>
          </Alert>
        ) : rows.length === 0 ? (
          <EmptyState
            title={q || category ? t('noMatchTitle') : t('emptyTitle')}
            message={q ? t('noMatch', { q }) : category ? t('noMatchCategory') : t('empty')}
            actions={
              !q && !category && !atLimit ? (
                <Button onClick={() => setEditing('new')}>{t('create')}</Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul className="space-y-3" aria-label={t('list')}>
              {rows.map((r) => (
                <ReplyRow
                  key={r.id}
                  reply={r}
                  busy={busy === r.id}
                  canCopy={!atLimit}
                  onEdit={() => setEditing(r)}
                  onDuplicate={() =>
                    void run(r.id, async () => {
                      await savedRepliesApi.duplicate(r.id);
                      toast(t('duplicated'), 'success');
                    })
                  }
                  onDelete={() => setDeleting(r)}
                />
              ))}
            </ul>
            {list.hasNextPage && (
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  disabled={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {list.isFetchingNextPage && <Spinner />}
                  {t('loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <SavedReplyForm
        open={editing !== null}
        reply={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(saved, created) => {
          setEditing(null);
          toast(created ? t('created', { shortcut: saved.shortcut }) : t('saved'), 'success');
          void refreshSavedReplies(qc);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={t('deleteTitle')}
        message={t(deleting?.scope === 'mine' ? 'deleteMine' : 'deleteShared', {
          shortcut: deleting?.shortcut ?? '',
        })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        busy={deleting !== null && busy === deleting.id}
        onConfirm={() => {
          if (!deleting) return;
          const d = deleting;
          void run(d.id, async () => {
            await savedRepliesApi.remove(d.id);
            setDeleting(null);
            toast(t('deleted'), 'success');
          });
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

export function ReplyRow({
  reply,
  busy,
  canCopy,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  reply: SavedReply;
  busy: boolean;
  canCopy: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('team-inbox-conversations.savedReplies.screen');
  const tk = useTranslations('team-inbox-conversations.savedReplies.channelKind');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const lastUsed = reply.lastUsedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(
        new Date(reply.lastUsedAt),
      )
    : null;

  return (
    <li
      data-testid="saved-reply-row"
      className="space-y-2 rounded-xl border border-border bg-background p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              /{reply.shortcut}
            </span>
            <h3 className="truncate text-base font-semibold">{reply.title}</h3>
            <Badge tone={reply.scope === 'shared' ? 'neutral' : 'warning'}>
              {t(`scope.${reply.scope}`)}
            </Badge>
            {reply.category && <Badge>{reply.category}</Badge>}
            {reply.language && <Badge>{reply.language}</Badge>}
          </div>
          <p
            dir="auto"
            className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground"
          >
            {reply.body}
          </p>
        </div>
        {reply.canEdit && (
          <span className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onEdit} disabled={busy}>
              {t('edit')}
            </Button>
            <Button variant="secondary" size="sm" onClick={onDuplicate} disabled={busy || !canCopy}>
              {t('duplicate')}
            </Button>
            <Button variant="secondary" size="sm" onClick={onDelete} disabled={busy}>
              {t('delete')}
            </Button>
          </span>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {reply.channelKinds.length === 0
            ? t('allChannels')
            : reply.channelKinds.map((k) => tk(k)).join(', ')}
        </span>
        <span>
          {reply.usedCount === 0 ? t('neverUsed') : t('used', { count: reply.usedCount })}
        </span>
        {lastUsed && <span>{t('lastUsed', { when: lastUsed })}</span>}
        {reply.scope === 'shared' && reply.createdByName && (
          <span>{t('createdBy', { name: reply.createdByName })}</span>
        )}
        {!reply.canEdit && <span>{t('readOnly')}</span>}
      </p>
    </li>
  );
}
