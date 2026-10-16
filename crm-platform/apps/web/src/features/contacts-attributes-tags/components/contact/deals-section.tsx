'use client';

import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { ContactDealsResponse, DealResponse, MoneyTotal } from '@crm/contracts';
import { Badge, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useContactDeals } from '../../api/deals';
import { formatMoney, isNotAvailableToYou } from '../../lib/contact-data';
import { ErrorLine } from '../error-line';
import { EmptyLine, Panel, type SectionProps } from './shared';

/** The deals endpoint answers at most this many (open first, then newest); the rollup counts all of them. */
const DEALS_CAP = 50;

const STATUS_TONE = { open: 'neutral', won: 'success', lost: 'danger' } as const;

/**
 * The contact's deals (`GET /contacts/:id/deals`): the rollup (open and won, each with its value per currency, never added across
 * currencies) and the list, open deals first. It needs `record.deals.read` and the sales-pipeline plan; when either is missing
 * (403, or 422 `PLAN_FEATURE_LOCKED`) the section says it is not available, which is not an error.
 */
export function DealsSection({ contact, variant }: SectionProps) {
  const t = useTranslations('contacts-attributes-tags.contact.deals');
  const canRead = useCan('record.deals.read');
  const deals = useContactDeals(contact.id, canRead);

  return (
    <Panel id="contact-deals" title={t('title')} bodyClassName={variant === 'drawer' ? 'px-3' : ''}>
      {!canRead || (deals.isError && isNotAvailableToYou(deals.error)) ? (
        <EmptyLine>{t('unavailable')}</EmptyLine>
      ) : deals.isPending ? (
        <div role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : deals.isError ? (
        <ErrorLine error={deals.error} onRetry={() => void deals.refetch()} />
      ) : (
        <DealsBody data={deals.data} />
      )}
    </Panel>
  );
}

function DealsBody({ data }: { data: ContactDealsResponse }) {
  const t = useTranslations('contacts-attributes-tags.contact.deals');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <RollupTile
          label={t('openRollup', { count: data.rollup.openCount })}
          totals={data.rollup.openValue}
        />
        <RollupTile
          label={t('wonRollup', { count: data.rollup.wonCount })}
          totals={data.rollup.wonValue}
        />
      </div>
      {data.deals.length === 0 ? (
        <EmptyLine>{t('empty')}</EmptyLine>
      ) : (
        <ul aria-label={t('listLabel')} className="space-y-2">
          {data.deals.map((d) => (
            <DealRow key={d.id} deal={d} />
          ))}
        </ul>
      )}
      {data.deals.length >= DEALS_CAP && (
        <p className="text-xs text-muted-foreground">{t('capped', { count: DEALS_CAP })}</p>
      )}
    </div>
  );
}

/** A count and one line per currency: the amounts of different currencies are never summed. */
function RollupTile({ label, totals }: { label: string; totals: readonly MoneyTotal[] }) {
  const t = useTranslations('contacts-attributes-tags.contact.deals');
  const locale = useLocale();
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {totals.length === 0 ? (
        <div className="mt-1 text-sm text-muted-foreground">{t('noValue')}</div>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {totals.map((m) => (
            <li
              key={m.currency}
              dir="ltr"
              className="text-start text-base font-semibold tabular-nums"
            >
              {formatMoney(m.amount, m.currency, locale)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Literal keys so every message is visibly used. */
function statusLabel(
  t: ReturnType<typeof useTranslations>,
  status: DealResponse['status'],
): string {
  switch (status) {
    case 'won':
      return t('status.won');
    case 'lost':
      return t('status.lost');
    default:
      return t('status.open');
  }
}

function DealRow({ deal }: { deal: DealResponse }) {
  const t = useTranslations('contacts-attributes-tags.contact.deals');
  const locale = useLocale();
  const format = useFormatter();
  // `expectedCloseDate` is a calendar day (YYYY-MM-DD): read it as that day in UTC so no time zone shifts it.
  const closes = deal.expectedCloseDate
    ? format.dateTime(new Date(`${deal.expectedCloseDate}T00:00:00Z`), {
        dateStyle: 'medium',
        timeZone: 'UTC',
      })
    : null;
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/deals/${deal.id}`}
          dir="auto"
          className="min-w-0 break-words text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          {deal.title}
        </Link>
        <span dir="ltr" className="shrink-0 text-sm font-semibold tabular-nums">
          {formatMoney(deal.value, deal.currency, locale)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-medium">
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-muted-foreground"
            style={{ backgroundColor: deal.stage.color }}
          />
          <span dir="auto">{deal.stage.name}</span>
        </span>
        <Badge tone={STATUS_TONE[deal.status]}>{statusLabel(t, deal.status)}</Badge>
        <span className="text-muted-foreground" dir="auto">
          {t('pipeline', { name: deal.pipeline.name })}
        </span>
      </div>
      {(closes || deal.owner) && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {closes && <span>{t('closes', { date: closes })}</span>}
          {deal.owner && <span dir="auto">{t('owner', { name: deal.owner.name })}</span>}
        </div>
      )}
    </li>
  );
}
