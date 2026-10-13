'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { GROWTH_ACTION_TYPES, type GrowthAction, type GrowthActionType } from '@crm/contracts';
import { Badge, Button, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useDecideActions, useGrowthActions } from '../api/hooks';
import { errorKey } from '../lib/errors';
import { LoadError, Nothing, SectionCard, SkeletonRows, useFormatDate } from './parts';

const SEVERITY_TONE = { urgent: 'danger', attention: 'warning', info: 'neutral' } as const;

/**
 * The Growth inbox: everything the pilot found that a person should look at. Accepting does the work of its kind (assigns the chat,
 * records the opt-out in the consent ledger); dismissing only closes it. Nothing here messages a contact.
 */
export function InboxTab() {
  const t = useTranslations('growth.inbox');
  const { toast } = useToast();
  const fmt = useFormatDate();
  const canReview = useCan('lsc.stage.review');
  const [type, setType] = useState<GrowthActionType | undefined>(undefined);
  const list = useGrowthActions(type, true);
  const decide = useDecideActions();

  const run = (action: 'accept' | 'dismiss', ids: string[]) =>
    decide.mutate(
      { action, ids },
      {
        onSuccess: (res) => {
          if (res.done > 0)
            toast(
              t(action === 'accept' ? 'doneAccept' : 'doneDismiss', { count: res.done }),
              'success',
            );
          if (res.failed.length > 0) toast(t('someFailed', { count: res.failed.length }), 'danger');
        },
      },
    );

  const counts = list.openByType;
  const total = counts ? GROWTH_ACTION_TYPES.reduce((s, k) => s + (counts[k] ?? 0), 0) : 0;
  return (
    <SectionCard id="growth-inbox" title={t('title')} hint={t('hint')}>
      <div role="group" aria-label={t('filter')} className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={type === undefined ? 'brand' : 'secondary'}
          aria-pressed={type === undefined}
          onClick={() => setType(undefined)}
        >
          {t('all', { count: total })}
        </Button>
        {GROWTH_ACTION_TYPES.map((k) => (
          <Button
            key={k}
            size="sm"
            variant={type === k ? 'brand' : 'secondary'}
            aria-pressed={type === k}
            onClick={() => setType(k)}
          >
            {t(`types.${k}`)} ({counts?.[k] ?? 0})
          </Button>
        ))}
      </div>
      {list.isPending && <SkeletonRows rows={3} />}
      {list.isError && (
        <LoadError
          errorKey={errorKey(list.error)}
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      )}
      {list.isSuccess && list.items.length === 0 && <Nothing>{t('empty')}</Nothing>}
      <ul className="space-y-3">
        {list.items.map((a) => (
          <ActionRow
            key={a.id}
            action={a}
            fmt={fmt}
            canReview={canReview}
            busy={decide.isPending}
            onDecide={run}
          />
        ))}
      </ul>
      {list.hasNextPage && (
        <Button
          variant="secondary"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage && <Spinner />}
          {t('more')}
        </Button>
      )}
    </SectionCard>
  );
}

function ActionRow({
  action: a,
  fmt,
  canReview,
  busy,
  onDecide,
}: {
  action: GrowthAction;
  fmt: (iso: string) => string;
  canReview: boolean;
  busy: boolean;
  onDecide: (action: 'accept' | 'dismiss', ids: string[]) => void;
}) {
  const t = useTranslations('growth.inbox');
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEVERITY_TONE[a.severity]}>{t(`types.${a.type}`)}</Badge>
            <span className="text-xs text-muted-foreground">{fmt(a.createdAt)}</span>
          </div>
          <p className="mt-1 text-sm font-medium">
            {t(`titles.${a.type}`, {
              name: a.contactName ?? t('someone'),
              user: typeof a.payload.userName === 'string' ? a.payload.userName : '',
              rule: typeof a.payload.rule === 'string' ? a.payload.rule : '',
            })}
          </p>
          {a.detail && <p className="mt-1 text-sm text-muted-foreground">{a.detail}</p>}
          <Facts action={a} />
          <Link
            href={`/contacts/${a.contactId}`}
            className="mt-1 inline-block text-sm text-primary underline"
          >
            {a.contactName ?? t('openContact')}
          </Link>
        </div>
        {canReview && (
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="brand"
              disabled={busy}
              onClick={() => onDecide('accept', [a.id])}
            >
              {t(`accept.${a.type}`)}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onDecide('dismiss', [a.id])}
            >
              {t('dismiss')}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/** The type specific facts a person needs to decide: the status to send, the days gone, the person to give the chat to. */
function Facts({ action: a }: { action: GrowthAction }) {
  const t = useTranslations('growth.inbox.facts');
  const p = a.payload;
  if (a.type === 'status_reply' && Array.isArray(p.facts)) {
    return (
      <dl className="mt-1 text-sm">
        {(p.facts as Array<{ key: string; value: string }>).map((f) => (
          <div key={f.key} className="flex gap-2">
            <dt className="text-muted-foreground">{f.key}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (a.type === 'purchase_route' && typeof p.userName === 'string') {
    return (
      <p className="mt-1 text-sm">
        {t(p.reason === 'owner' ? 'routeOwner' : 'routeLeastBusy', { name: p.userName })}
      </p>
    );
  }
  if (a.type === 'lapsed' && typeof p.days === 'number') {
    return <p className="mt-1 text-sm">{t('lapsedDays', { count: p.days })}</p>;
  }
  if (a.type === 'registration_issue' && typeof p.issue === 'string') {
    return <p className="mt-1 text-sm">{t(`issue.${p.issue}` as 'issue.missing_confirmation')}</p>;
  }
  return null;
}
