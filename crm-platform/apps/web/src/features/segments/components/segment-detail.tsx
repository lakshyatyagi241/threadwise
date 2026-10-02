'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  EmptyState,
  Menu,
  MenuItem,
  MenuSeparator,
  Select,
  Spinner,
  cn,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ContactsReadonlyTable } from '@/features/contacts-attributes-tags';
import { useSegmentCatalog } from '../api/lookups';
import { useSegment, useSegmentMembers, useSegments } from '../api/segments';
import type { Segment } from '../api/schemas';
import { errorKind } from '../lib/errors';
import { summarizeConditions } from '../lib/summary';
import { HUB_PAGE_SIZES, ROUTES, type HubPageSize } from '../lib/url';
import { fromWire } from '../lib/wire';
import {
  ArrowLeftIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FunnelIcon,
  MoreIcon,
  PencilIcon,
  TagIcon,
  TrashIcon,
  UsersPlusIcon,
  WarningIcon,
} from './icons';
import { AttentionChip, ErrorLine, MemberCount, VisibilityChip } from './parts';
import {
  SegmentDialogs,
  useSegmentActions,
  useSegmentCan,
  type SegmentActions,
} from './segment-actions';
import { useSummaryContext } from './use-summary';

/** `/segments/:id`: the segment's header and actions, its rules as sentences, and its members as the Contact Hub table. */
export function SegmentDetail({ id }: { id: string }) {
  const t = useTranslations('segments.detail');
  const router = useRouter();
  const query = useSegment(id);
  const all = useSegments(false);
  const can = useSegmentCan();
  const actions = useSegmentActions({
    taken: () => (all.data ?? []).map((s) => s.name),
    onDeleted: () => router.push(ROUTES.hub),
  });

  const back = (
    <Link
      href={ROUTES.hub}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
    >
      <ArrowLeftIcon className="size-3.5 rtl:rotate-180" />
      {t('back')}
    </Link>
  );

  if (query.isPending) {
    return (
      <div role="status" aria-label={t('loading')} className="animate-pulse space-y-3">
        <div className="h-28 rounded-xl bg-muted" />
        <div className="h-24 rounded-xl bg-muted" />
        <div className="h-72 rounded-xl bg-muted" />
      </div>
    );
  }
  if (query.isError) {
    const gone = errorKind(query.error) === 'notFound';
    return (
      <div className="space-y-3">
        {back}
        {gone ? (
          <EmptyState
            title={t('notFoundTitle')}
            message={t('notFound')}
            actions={
              <Button variant="secondary" onClick={() => router.push(ROUTES.hub)}>
                {t('back')}
              </Button>
            }
          />
        ) : (
          <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }

  const segment = query.data;
  return (
    <div className="space-y-3">
      <Header segment={segment} back={back} actions={actions} can={can} />
      <RulesCard segment={segment} canEdit={can.edit(segment)} />
      <Members segment={segment} canEdit={can.edit(segment)} />
      <SegmentDialogs controller={actions} />
    </div>
  );
}

function Header({
  segment,
  back,
  actions,
  can,
}: {
  segment: Segment;
  back: ReactNode;
  actions: SegmentActions;
  can: ReturnType<typeof useSegmentCan>;
}) {
  const t = useTranslations('segments.detail');
  const th = useTranslations('segments.hub');
  const router = useRouter();
  const format = useFormatter();
  const canReadContacts = useCan('record.contacts.read');
  const owner = segment.ownerName;
  return (
    <header className="space-y-3 rounded-xl border border-border bg-background px-4 py-3">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ background: segment.color || 'var(--brand)' }}
          >
            <FunnelIcon className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 className="break-words text-xl font-bold tracking-tight">{segment.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <VisibilityChip visibility={segment.visibility} />
              {segment.invalidConditions.length > 0 && (
                <AttentionChip count={segment.invalidConditions.length} />
              )}
              <span className="text-xs text-muted-foreground">
                {owner ? t('byOwner', { name: owner }) : ''}
                {owner ? ' · ' : ''}
                {t('updated', {
                  when: format.dateTime(new Date(segment.updatedAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                })}
              </span>
            </div>
            {segment.description && (
              <p className="max-w-2xl text-sm text-muted-foreground">{segment.description}</p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('members')}
          </span>
          <MemberCount
            segment={segment}
            size="lg"
            refreshing={actions.refreshing.has(segment.id)}
            onRefresh={() => void actions.refresh(segment)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {can.edit(segment) && (
          <Button variant="brand" onClick={() => router.push(ROUTES.edit(segment.id))}>
            <PencilIcon /> {t('editRules')}
          </Button>
        )}
        {canReadContacts && (
          <Link
            href={ROUTES.contacts(segment.id)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            <EyeIcon /> {t('viewInContacts')}
          </Link>
        )}
        {can.export && (
          <Button
            variant="secondary"
            disabled={actions.exporting.has(segment.id)}
            onClick={() => void actions.exportCsv(segment)}
          >
            {actions.exporting.has(segment.id) ? <Spinner /> : <DownloadIcon />} {th('export')}
          </Button>
        )}
        <Menu
          label={t('moreActions')}
          align="start"
          triggerClassName="h-10"
          trigger={
            <>
              <MoreIcon /> {t('more')}
            </>
          }
        >
          {can.members && (
            <>
              <MenuItem onSelect={() => actions.open('tag', segment)}>
                <TagIcon /> {th('tagMembers')}
              </MenuItem>
              <MenuItem onSelect={() => actions.open('group', segment)}>
                <UsersPlusIcon /> {th('addToGroup')}
              </MenuItem>
            </>
          )}
          {can.create && (
            <MenuItem onSelect={() => void actions.duplicate(segment)}>
              <CopyIcon /> {th('duplicate')}
            </MenuItem>
          )}
          {can.remove(segment) && (
            <>
              <MenuSeparator />
              <MenuItem danger onSelect={() => actions.open('delete', segment)}>
                <TrashIcon /> {th('delete')}
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}

function RulesCard({ segment, canEdit }: { segment: Segment; canEdit: boolean }) {
  const t = useTranslations('segments.detail');
  const ti = useTranslations('segments.invalid');
  const lookups = useSegmentCatalog();
  const ctx = useSummaryContext(lookups.catalog);
  const tree = fromWire(segment.rules);
  const lines = lookups.ready ? summarizeConditions(tree, ctx) : null;
  return (
    <section aria-label={t('rulesTitle')} className="rounded-xl border border-border bg-background">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">{t('rulesTitle')}</h2>
        <span className="text-xs text-muted-foreground">
          {t(segment.rules.combinator === 'and' ? 'matchAll' : 'matchAny')}
        </span>
      </header>
      <div className="space-y-3 p-4">
        {lines === null ? (
          <div
            role="status"
            aria-label={t('loading')}
            className="h-4 w-2/3 animate-pulse rounded bg-muted"
          />
        ) : (
          <ul className="space-y-1.5 text-sm">
            {lines.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
        {segment.invalidConditions.length > 0 && (
          <Alert tone="warning" className="space-y-2">
            <p className="flex items-center gap-1.5 font-medium">
              <WarningIcon className="size-4" />
              {t('invalidTitle', { count: segment.invalidConditions.length })}
            </p>
            <ul className="list-disc space-y-0.5 ps-5 text-xs">
              {segment.invalidConditions.map((c) => (
                <li key={`${c.path}:${c.reason}`}>{ti(`reason.${c.reason}`)}</li>
              ))}
            </ul>
            {canEdit && (
              <Link
                href={ROUTES.edit(segment.id)}
                className="inline-block text-xs font-semibold underline underline-offset-2"
              >
                {t('fixRules')}
              </Link>
            )}
          </Alert>
        )}
      </div>
    </section>
  );
}

function Members({ segment, canEdit }: { segment: Segment; canEdit: boolean }) {
  const t = useTranslations('segments.detail');
  const [per, setPer] = useState<HubPageSize>(25);
  const members = useSegmentMembers(segment.id, per);
  const canRead = useCan('record.contacts.read');
  const from = (members.pageNumber - 1) * per + 1;
  const to = from + members.items.length - 1;
  return (
    <section
      aria-label={t('membersTitle')}
      aria-busy={members.isFetching}
      className="flex max-h-[max(26rem,calc(100dvh-14rem))] flex-col overflow-hidden rounded-xl border border-border bg-background"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">{t('membersTitle')}</h2>
        <span className="text-xs text-muted-foreground">{t('membersHint')}</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {!canRead ? (
          <div className="p-4">
            <EmptyState title={t('noAccessTitle')} message={t('noAccess')} />
          </div>
        ) : members.isPending ? (
          <div role="status" aria-label={t('loading')} className="divide-y divide-border">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex h-16 animate-pulse items-center gap-4 px-4">
                <span className="size-8 rounded-full bg-muted" />
                <span className="h-3 w-40 rounded bg-muted" />
                <span className="ms-auto h-3 w-24 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : members.isError ? (
          <div className="p-4">
            <ErrorLine error={members.error} onRetry={() => void members.refetch()} />
          </div>
        ) : members.items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={t('emptyTitle')}
              message={t('empty')}
              actions={
                canEdit ? (
                  <Link
                    href={ROUTES.edit(segment.id)}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
                  >
                    {t('editRules')}
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col transition-opacity',
              members.isPlaceholderData && 'opacity-60',
            )}
          >
            <ContactsReadonlyTable rows={members.items} />
          </div>
        )}
      </div>
      {canRead && members.isSuccess && members.items.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-2.5 text-sm">
          <span className="text-muted-foreground" aria-live="polite">
            {members.isFetching && <Spinner label={t('loading')} />}{' '}
            {members.total === undefined
              ? t('rangeNoTotal', { from, to })
              : t('range', { from, to, total: members.total })}
          </span>
          <nav aria-label={t('pagination')} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!members.hasPrevious}
              onClick={members.goPrevious}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {t('previous')}
            </button>
            <span className="tabular-nums text-muted-foreground">
              {t('pageNumber', { page: members.pageNumber })}
            </span>
            <button
              type="button"
              disabled={!members.hasNext}
              onClick={members.goNext}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {t('next')}
            </button>
            <Select
              aria-label={t('perPage')}
              className="h-8 w-auto py-0"
              value={per}
              onChange={(e) => setPer(Number(e.target.value) as HubPageSize)}
            >
              {HUB_PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {t('perPageOption', { count: n })}
                </option>
              ))}
            </Select>
          </nav>
        </div>
      )}
    </section>
  );
}
