'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Popover, cn } from '@crm/ui';
import { PQL_QUERY_MAX } from '@crm/contracts';
import { AdvancedFilter } from '@/features/segments';
import { askPql } from '../api/pql';
import type { ContactFilters } from '../api/contacts';
import type { Choice } from '../lib/option-sets';
import { ChevronDownIcon, FilterIcon, SparkIcon } from './icons';

type View = 'menu' | 'ai' | 'stage' | 'consent';
type Outcome = { kind: 'ignored'; parts: string[] } | { kind: 'empty' } | { kind: 'failed' };

export interface FilterPanelProps {
  stage: string;
  stages: readonly Choice[];
  /** The workspace's tags, so the suggestions name things the person actually has. */
  tags: ReadonlyArray<{ id: string; name: string }>;
  onStage: (v: string) => void;
  consent: ContactFilters['consent'];
  onConsent: (v: ContactFilters['consent']) => void;
  /** Conditions applied now (JSON text of a rule tree), or empty. */
  rules: string;
  onRules: (rulesJson: string) => void;
  /** What the AI understood, for the chip under the toolbar. */
  onAiSummary: (rulesJson: string, summary: string) => void;
  /** How many conditions `rules` holds (the badge). */
  conditionCount: number;
}

const row =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

/**
 * The Contact Hub's one Filter button. Its panel starts with "Filter with AI" (describe the contacts in plain English), then the
 * quick filters (stage, consent) and "Add advanced filter" (the full condition builder). Whatever is applied shows as a count on
 * the button and as a chip under the toolbar.
 */
export function FilterPanel(p: FilterPanelProps) {
  const t = useTranslations('contacts-attributes-tags.list');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('menu');
  const [builder, setBuilder] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // Suggestions use this workspace's own first tag and stage, so they read like something the person would really ask.
  const tag = p.tags[0]?.name;
  const stage = p.stages.find((x) => x.value !== '')?.label;
  const examples = [
    tag ? t('pqlExampleTag', { tag }) : t('pqlExample2'),
    stage ? t('pqlExampleStage', { stage }) : t('pqlExample3'),
    t('pqlExampleNoOwner'),
  ];
  const quick = Number(p.stage !== '') + Number(p.consent !== '');
  const on = quick + p.conditionCount;
  const close = () => {
    setOpen(false);
    setView('menu');
    setOutcome(null);
  };

  async function ask(query: string) {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const r = await askPql(q);
      if (!r.rules) {
        setOutcome({ kind: 'empty' });
        return;
      }
      const json = JSON.stringify(r.rules);
      p.onRules(json);
      p.onAiSummary(json, r.summary);
      if (r.ignored.length > 0) setOutcome({ kind: 'ignored', parts: r.ignored });
      else close();
    } catch {
      setOutcome({ kind: 'failed' });
    } finally {
      setBusy(false);
    }
  }

  const stageName = p.stages.find((s) => s.value === p.stage)?.label;
  const consentName =
    p.consent === 'subscribed'
      ? t('subscribedOnly')
      : p.consent === 'unsubscribed'
        ? t('unsubscribedOnly')
        : undefined;

  const back = (
    <button
      type="button"
      onClick={() => setView('menu')}
      className="mb-1 inline-flex items-center gap-1 rounded px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
    >
      <ChevronDownIcon className="size-3.5 rotate-90 rtl:-rotate-90" />
      {t('back')}
    </button>
  );

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          'inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border bg-background px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
          on > 0 ? 'border-brand' : 'border-border',
        )}
      >
        <FilterIcon className="size-4 text-muted-foreground" />
        {t('filter')}
        {on > 0 && (
          <span className="rounded-full bg-brand px-1.5 text-[11px] leading-5 text-brand-foreground">
            {on}
          </span>
        )}
      </button>

      <Popover
        open={open}
        onClose={close}
        label={t('moreFilters')}
        className="w-[22rem] max-w-[calc(100vw-2rem)] space-y-0 p-2"
      >
        {view === 'menu' && (
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => setView('ai')}
              className={cn(row, 'bg-brand/10 font-medium text-brand hover:bg-brand/15')}
            >
              <SparkIcon />
              <span className="flex-1">
                {t('filterAi')}
                <span className="block text-xs font-normal text-muted-foreground">
                  {t('filterAiHint')}
                </span>
              </span>
            </button>
            <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('quickFilters')}
            </p>
            <button type="button" className={row} onClick={() => setView('stage')}>
              <span className="flex-1">{t('stageFilter')}</span>
              <span className="max-w-[8rem] truncate text-xs text-muted-foreground">
                {stageName}
              </span>
              <ChevronDownIcon className="size-3.5 -rotate-90 text-muted-foreground rtl:rotate-90" />
            </button>
            <button type="button" className={row} onClick={() => setView('consent')}>
              <span className="flex-1">{t('consentFilter')}</span>
              <span className="text-xs text-muted-foreground">{consentName}</span>
              <ChevronDownIcon className="size-3.5 -rotate-90 text-muted-foreground rtl:rotate-90" />
            </button>
            <button
              type="button"
              className={cn(row, 'text-brand')}
              onClick={() => {
                close();
                setBuilder(true);
              }}
            >
              <span aria-hidden="true">+</span>
              <span className="flex-1">{t('filterAdvanced')}</span>
              {p.conditionCount > 0 && (
                <span className="text-xs text-muted-foreground">{p.conditionCount}</span>
              )}
            </button>
          </div>
        )}

        {view === 'ai' && (
          <div className="space-y-2 p-1">
            {back}
            <form
              className="flex items-center gap-2 rounded-md border border-brand bg-background px-2.5 focus-within:ring-2 focus-within:ring-primary"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(text);
              }}
            >
              <SparkIcon className="size-4 shrink-0 text-brand" />
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={PQL_QUERY_MAX}
                placeholder={t('pqlPromptPlaceholder')}
                aria-label={t('pqlLabel')}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                disabled={busy || text.trim() === ''}
                className="rounded px-2 py-1 text-xs font-medium text-brand outline-none hover:bg-brand/10 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                {busy ? t('pqlAsking') : t('pqlAsk')}
              </button>
            </form>
            <div role="group" className="flex flex-wrap gap-1.5" aria-label={t('pqlTry')}>
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setText(example);
                    void ask(example);
                  }}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {example}
                </button>
              ))}
            </div>
            <div role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
              {outcome?.kind === 'ignored' && (
                <p>{t('pqlIgnored', { parts: outcome.parts.join(', ') })}</p>
              )}
              {outcome?.kind === 'empty' && <p>{t('pqlNothing')}</p>}
              {outcome?.kind === 'failed' && <p className="text-destructive">{t('pqlFailed')}</p>}
            </div>
          </div>
        )}

        {view === 'stage' && (
          <div role="radiogroup" aria-label={t('stageFilter')} className="space-y-0.5 p-1">
            {back}
            {[{ value: '', label: t('allStages') }, ...p.stages].map((s) => (
              <button
                key={s.value || 'all'}
                type="button"
                role="radio"
                aria-checked={p.stage === s.value}
                className={cn(row, p.stage === s.value && 'font-medium text-brand')}
                onClick={() => {
                  p.onStage(s.value);
                  close();
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {view === 'consent' && (
          <div role="radiogroup" aria-label={t('consentFilter')} className="space-y-0.5 p-1">
            {back}
            {(
              [
                ['', t('allConsent')],
                ['subscribed', t('subscribedOnly')],
                ['unsubscribed', t('unsubscribedOnly')],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v || 'all'}
                type="button"
                role="radio"
                aria-checked={p.consent === v}
                className={cn(row, p.consent === v && 'font-medium text-brand')}
                onClick={() => {
                  p.onConsent(v);
                  close();
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </Popover>

      <AdvancedFilter
        value={p.rules}
        onApply={p.onRules}
        open={builder}
        onOpenChange={setBuilder}
        hideTrigger
      />
    </div>
  );
}
