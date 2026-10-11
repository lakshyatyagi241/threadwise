'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FaqLogItem } from '@crm/contracts';
import { Badge, Button, Modal, Spinner } from '@crm/ui';
import { useFaqList } from '../api/hooks';
import { pct, tierKey, verdictOf, verdictTone } from '../lib/decision';
import { EMPTY_FILTERS } from '../lib/list-model';
import { whyKey } from '../lib/log-model';
import { SearchIcon } from './icons';
import { useDebounced } from './parts';

export function OutcomeBadge({ outcome }: { outcome: FaqLogItem['outcome'] }) {
  const t = useTranslations('faq.decision.verdict');
  const v = verdictOf(outcome);
  return <Badge tone={verdictTone(v)}>{t(`${v}.title`)}</Badge>;
}

/** "Why" in one sentence, with the numbers that decided it. */
export function WhyText({ row, threshold }: { row: FaqLogItem; threshold?: number }) {
  const t = useTranslations('faq.log.why');
  // Without the workspace bar to compare with, a "below the 0% bar" sentence would be wrong: say less instead.
  const key = whyKey(row);
  const name = key === 'belowThreshold' && threshold === undefined ? 'belowThresholdNoBar' : key;
  return (
    <p className="text-sm text-muted-foreground">
      {t(name, {
        score: row.score === null ? 0 : pct(row.score),
        second: row.secondScore === null ? 0 : pct(row.secondScore),
        threshold: threshold === undefined ? 0 : pct(threshold),
        faq: row.faqQuestion ?? '',
      })}
      {row.tier && <> {t('tier', { tier: tierKey(row.tier) })}</>}
      {row.error && <> {t('error', { error: row.error })}</>}
    </p>
  );
}

/** The candidates a decision considered, best first. */
export function CandidateList({ row }: { row: FaqLogItem }) {
  const t = useTranslations('faq.log');
  if (row.candidates.length === 0)
    return <p className="text-sm text-muted-foreground">{t('noCandidates')}</p>;
  return (
    <ol className="space-y-1 text-sm">
      {row.candidates.map((c, i) => (
        <li key={c.faqId} className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="min-w-0">
            <span className="me-1.5 text-muted-foreground tabular-nums">{i + 1}.</span>
            {c.question}
            <span className="ms-2 text-xs text-muted-foreground">
              {t('matchedOn')} <q>{c.matchedText}</q>
            </span>
          </span>
          <span className="font-semibold tabular-nums">{pct(c.score)}%</span>
        </li>
      ))}
    </ol>
  );
}

/** Searchable choice of one FAQ (for "Add to an FAQ"). */
export function FaqPickerModal({
  open,
  title,
  busy,
  onClose,
  onPick,
}: {
  open: boolean;
  title: string;
  busy?: boolean;
  onClose: () => void;
  onPick: (faq: { id: string; question: string }) => void;
}) {
  const t = useTranslations('faq.picker');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const list = useFaqList(EMPTY_FILTERS, debounced, open);
  return (
    <Modal open={open} onClose={onClose} title={title} size="md" closeLabel={t('close')}>
      <div className="space-y-3">
        <div className="relative">
          <label htmlFor="faq-picker-search" className="sr-only">
            {t('search')}
          </label>
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            id="faq-picker-search"
            type="search"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-10 w-full rounded-md border border-border bg-background ps-9 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        <div aria-live="polite" className="max-h-72 overflow-auto rounded-md border border-border">
          {list.isPending ? (
            <p className="p-3 text-sm text-muted-foreground">{t('loading')}</p>
          ) : list.items.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{t('none')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {list.items.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPick({ id: f.id, question: f.question })}
                    className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">{f.question}</span>
                    {f.status === 'paused' && <Badge tone="warning">{t('paused')}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {list.hasNextPage && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
          >
            {list.isFetchingNextPage && <Spinner />}
            {t('more')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
