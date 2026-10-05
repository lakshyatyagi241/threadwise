'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Button, Spinner } from '@crm/ui';
import { useCompanyActivity } from '../api/companies';
import type { CompanyActivityEntry } from '../api/schemas';
import { changeViews, type ChangeView } from '../lib/activity';
import { ErrorLine } from './error-line';

/** One changed field or contact link, in words. */
function Change({ view }: { view: ChangeView }) {
  const t = useTranslations('companies.activity');
  const f = useTranslations('companies.activity.fields');
  const empty = <span className="italic text-muted-foreground">{t('empty')}</span>;
  switch (view.kind) {
    case 'field':
      return (
        <li dir="auto">
          <span className="font-medium">{f(view.field)}</span>
          {': '}
          {view.old === null ? (
            empty
          ) : (
            <span className="break-words line-through opacity-70">{view.old}</span>
          )}
          {' → '}
          {view.new === null ? empty : <span className="break-words">{view.new}</span>}
        </li>
      );
    case 'contactLinked':
    case 'contactUnlinked':
      return (
        <li>
          {t(view.kind === 'contactLinked' ? 'contactLinked' : 'contactUnlinked')}{' '}
          <Link
            href={`/contacts/${view.contact.id}`}
            className="font-medium text-brand underline-offset-2 hover:underline dark:text-primary"
          >
            {view.contact.name ?? t('deletedContact')}
          </Link>
        </li>
      );
    case 'other':
      return <li>{view.field}</li>;
  }
}

function Entry({ entry }: { entry: CompanyActivityEntry }) {
  const t = useTranslations('companies.activity');
  const format = useFormatter();
  const views = changeViews(entry);
  return (
    <li className="space-y-1 border-s-2 border-border ps-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span>
          <span className="font-medium">{entry.actor?.name ?? t('system')}</span>{' '}
          <span className="text-muted-foreground">{t(`actions.${entry.action}`)}</span>
        </span>
        <time dateTime={entry.at} className="text-xs text-muted-foreground">
          {format.dateTime(new Date(entry.at), { dateStyle: 'medium', timeStyle: 'short' })}
        </time>
      </div>
      {views.length > 0 && entry.action !== 'delete' && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {views.map((v, i) => (
            <Change key={i} view={v} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Who changed what, newest first, from the company's audit trail (TW-CTP-007). Reference kept none. */
export function ActivityCard({ companyId }: { companyId: string }) {
  const t = useTranslations('companies.activity');
  const list = useCompanyActivity(companyId);
  return (
    <section
      aria-labelledby="company-activity"
      className="space-y-3 rounded-md border border-border bg-background p-4"
    >
      <h2
        id="company-activity"
        className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
      >
        {t('title')}
      </h2>
      {list.isPending ? (
        <div role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : list.isError ? (
        <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{t('none')}</p>
      ) : (
        <ol className="space-y-4">
          {list.items.map((e, i) => (
            <Entry key={`${e.at}-${i}`} entry={e} />
          ))}
        </ol>
      )}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          size="sm"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage && <Spinner />}
          {t('loadMore')}
        </Button>
      )}
    </section>
  );
}
