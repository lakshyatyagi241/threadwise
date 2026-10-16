'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Popover, cn } from '@crm/ui';
import { PQL_QUERY_MAX } from '@crm/contracts';
import { AdvancedFilter } from '@/features/segments';
import { askPql } from '../api/pql';
import { ownerTokens, UNASSIGNED_OWNER, type ContactFilters } from '../api/contacts';
import type { Owner } from '../api/owners';
import type { ContactStats } from '../api/schemas';
import { filtersOfPicker, pickerValue } from '../lib/segment-entries';
import type { Choice } from '../lib/option-sets';
import {
  pickerLabel,
  SegmentList,
  type GroupOption,
  type SegmentOption,
  type SegmentsState,
} from './segment-picker';
import { CheckIcon, ChevronDownIcon, FilterIcon, SparkIcon } from './icons';

/** The parts of the panel that can be opened straight away (a column header's "Filter" does that). */
export type FilterSection =
  'segment' | 'tag' | 'owner' | 'stage' | 'status' | 'minor' | 'consent' | 'source' | 'ai';

type View = 'menu' | FilterSection;
type Outcome = { kind: 'ignored'; parts: string[] } | { kind: 'empty' } | { kind: 'failed' };

type FilterValues = Pick<
  ContactFilters,
  | 'group'
  | 'imported'
  | 'segment'
  | 'tag'
  | 'owner'
  | 'lifecycleStage'
  | 'status'
  | 'minor'
  | 'consent'
  | 'source'
  | 'rules'
>;

export interface FilterPanelProps {
  filters: FilterValues;
  onChange: (patch: Partial<ContactFilters>) => void;

  stats: ContactStats | undefined;
  groups: readonly GroupOption[];
  segments: readonly SegmentOption[];
  segmentsState: SegmentsState;
  onRetrySegments: () => void;
  canCreateSegment: boolean;

  tags: ReadonlyArray<{ id: string; name: string }>;
  owners: readonly Owner[];
  /** The signed-in person, for "My contacts". */
  meId: string;
  /**
   * Present when the owner filter names exactly one person and the caller may change owners: selects everything the view matches and
   * opens the owner change (the shortcut for "move all of this person's contacts").
   */
  onReassignView?: () => void;

  stages: readonly Choice[];
  statuses: readonly Choice[];

  /** What the AI understood, for the chip under the toolbar. */
  onAiSummary: (rulesJson: string, summary: string) => void;
  /** How many conditions `filters.rules` holds (the badge). */
  conditionCount: number;
  /** Opens the panel on a section from outside; each new `nonce` opens it again. */
  request?: { section: FilterSection; nonce: number } | null;
}

const row =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

/** How many quick filters (everything but the conditions) are on. */
export function quickFilterCount(f: FilterValues): number {
  return (
    Number(f.group !== '' || f.imported || f.segment !== '') +
    Number(f.tag !== '') +
    Number(ownerTokens(f.owner).length > 0) +
    Number(f.lifecycleStage !== '') +
    Number(f.status !== '') +
    Number(f.minor !== '') +
    Number(f.consent !== '') +
    Number(f.source.trim() !== '')
  );
}

/**
 * The Contact Hub's one Filter button and its panel: Filter with AI first, then the segment or group, tag, owner, lifecycle stage,
 * status, consent and source, and "Add advanced filter" (the full condition builder: custom properties, a time-zone property,
 * dates). Each row shows what is chosen and opens its own choices; whatever is applied shows as a count on the button and as a
 * chip under the toolbar.
 */
export function FilterPanel(p: FilterPanelProps) {
  const t = useTranslations('contacts-attributes-tags.list');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('menu');
  const [builder, setBuilder] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [source, setSource] = useState(p.filters.source);
  const seen = useRef(0);

  // A request from outside (a column header's "Filter") opens the panel on that section, once per request.
  useEffect(() => {
    if (!p.request || p.request.nonce === seen.current) return;
    seen.current = p.request.nonce;
    setView(p.request.section);
    setOpen(true);
  }, [p.request]);

  const f = p.filters;
  // Suggestions use this workspace's own first tag and stage, so they read like something the person would really ask.
  const tag = p.tags[0]?.name;
  const stage = p.stages.find((x) => x.value !== '')?.label;
  const examples = [
    tag ? t('pqlExampleTag', { tag }) : t('pqlExample2'),
    stage ? t('pqlExampleStage', { stage }) : t('pqlExample3'),
    t('pqlExampleNoOwner'),
  ];
  const on = quickFilterCount(f) + p.conditionCount;
  const close = () => {
    setOpen(false);
    setView('menu');
    setOutcome(null);
  };
  const pick = (patch: Partial<ContactFilters>) => {
    p.onChange(patch);
    close();
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
      p.onChange({ rules: json });
      p.onAiSummary(json, r.summary);
      if (r.ignored.length > 0) setOutcome({ kind: 'ignored', parts: r.ignored });
      else close();
    } catch {
      setOutcome({ kind: 'failed' });
    } finally {
      setBusy(false);
    }
  }

  const owners = ownerTokens(f.owner);
  const pickedValue = pickerValue(f);
  const segmentName =
    pickedValue === ''
      ? undefined
      : pickerLabel(pickedValue, p.groups, p.segments, {
          all: t('allContacts'),
          imported: t('imported'),
          noGroup: t('noGroup'),
          segmentFallback: t('segmentFallback'),
        });
  const tagName = p.tags.find((x) => x.id === f.tag)?.name;
  const ownerName =
    owners.length === 0
      ? undefined
      : owners.length > 1
        ? t('ownersCount', { count: owners.length })
        : owners[0] === UNASSIGNED_OWNER
          ? t('unassigned')
          : owners[0] === p.meId
            ? t('myContacts')
            : (p.owners.find((o) => o.id === owners[0])?.fullName ?? t('ownerFormer'));
  const stageName = p.stages.find((s) => s.value === f.lifecycleStage)?.label;
  const statusName = p.statuses.find((s) => s.value === f.status)?.label;
  const minorName = f.minor === 'yes' ? t('minorYes') : f.minor === 'no' ? t('minorNo') : undefined;
  const consentName =
    f.consent === 'subscribed'
      ? t('subscribedOnly')
      : f.consent === 'unsubscribed'
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

  const entry = (section: FilterSection, label: string, value: string | undefined) => (
    <button key={section} type="button" className={row} onClick={() => setView(section)}>
      <span className="flex-1">{label}</span>
      <span
        className={cn(
          'max-w-[10rem] truncate text-xs',
          value ? 'font-medium text-brand' : 'text-muted-foreground',
        )}
      >
        {value ?? t('filterAny')}
      </span>
      <ChevronDownIcon className="size-3.5 -rotate-90 text-muted-foreground rtl:rotate-90" />
    </button>
  );

  /** One radio row of a choice list. */
  const choice = (
    key: string,
    label: ReactNode,
    selected: boolean,
    onPick: () => void,
    swatch?: string,
  ) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn(row, selected && 'font-medium text-brand')}
      onClick={onPick}
    >
      <CheckIcon className={cn('size-3.5 shrink-0', !selected && 'invisible')} />
      {swatch && (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ background: swatch }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );

  const toggleOwner = (token: string, checked: boolean) => {
    const next = owners.filter((x) => x !== token);
    p.onChange({ owner: (checked ? [...next, token] : next).join(',') });
  };
  const onlyPerson = owners.length === 1 && owners[0] !== UNASSIGNED_OWNER ? owners[0] : undefined;

  return (
    <div className="sm:relative">
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
        className="start-0 end-auto z-40 w-[min(24rem,calc(100vw-2rem))] space-y-0 p-2 max-sm:inset-x-0 max-sm:w-auto"
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
            <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('quickFilters')}
            </p>
            {entry('segment', t('segmentLabel'), segmentName)}
            {entry('tag', t('tagLabel'), tagName)}
            {entry('owner', t('ownerLabel'), ownerName)}
            {entry('stage', t('stageLabel'), stageName)}
            {entry('status', t('statusLabel'), statusName)}
            {entry('minor', t('minorLabel'), minorName)}
            {entry('consent', t('consentLabel'), consentName)}
            {entry('source', t('sourceLabel'), f.source.trim() || undefined)}
            <button
              type="button"
              className={cn(row, 'text-brand')}
              onClick={() => {
                close();
                setBuilder(true);
              }}
            >
              <span aria-hidden="true">+</span>
              <span className="flex-1">
                {t('filterAdvanced')}
                <span className="block text-xs font-normal text-muted-foreground">
                  {t('filterAdvancedHint')}
                </span>
              </span>
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

        {view === 'segment' && (
          <div className="p-1">
            {back}
            <SegmentList
              value={pickedValue}
              onChange={(v) => pick(filtersOfPicker(v))}
              counts={{
                total: p.stats?.total,
                imported: p.stats?.imported,
                noGroup: p.stats?.noGroup,
              }}
              groups={p.groups}
              segments={p.segments}
              segmentsState={p.segmentsState}
              canCreateSegment={p.canCreateSegment}
              onRetrySegments={p.onRetrySegments}
            />
          </div>
        )}

        {view === 'tag' && (
          <div
            role="radiogroup"
            aria-label={t('tagFilter')}
            className="thin-scrollbar max-h-72 space-y-0.5 overflow-y-auto p-1"
          >
            {back}
            {choice('all', t('allTags'), f.tag === '', () => pick({ tag: '' }))}
            {p.tags.map((x) => choice(x.id, x.name, f.tag === x.id, () => pick({ tag: x.id })))}
          </div>
        )}

        {view === 'owner' && (
          <div
            role="group"
            aria-label={t('ownerFilter')}
            className="thin-scrollbar max-h-72 space-y-0.5 overflow-y-auto p-1"
          >
            {back}
            {choice('all', t('allOwners'), owners.length === 0, () => p.onChange({ owner: '' }))}
            {choice('me', t('myContacts'), owners.length === 1 && owners[0] === p.meId, () =>
              p.onChange({ owner: p.meId }),
            )}
            <label className={cn(row, 'cursor-pointer')}>
              <input
                type="checkbox"
                className="size-4 accent-[var(--brand)]"
                checked={owners.includes(UNASSIGNED_OWNER)}
                onChange={(e) => toggleOwner(UNASSIGNED_OWNER, e.target.checked)}
              />
              {t('unassigned')}
            </label>
            {p.owners.map((o) => (
              <label key={o.id} className={cn(row, 'cursor-pointer')}>
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--brand)]"
                  checked={owners.includes(o.id)}
                  onChange={(e) => toggleOwner(o.id, e.target.checked)}
                />
                <span className="min-w-0 flex-1 truncate">
                  {o.id === p.meId ? t('ownerMe', { name: o.fullName }) : o.fullName}
                </span>
              </label>
            ))}
            {p.onReassignView && onlyPerson && (
              <button
                type="button"
                className={cn(row, 'mt-1 border-t border-border text-brand')}
                onClick={() => {
                  close();
                  p.onReassignView?.();
                }}
              >
                {t('reassignView', {
                  name: p.owners.find((o) => o.id === onlyPerson)?.fullName ?? t('ownerFormer'),
                })}
              </button>
            )}
          </div>
        )}

        {view === 'stage' && (
          <div
            role="radiogroup"
            aria-label={t('stageFilter')}
            className="thin-scrollbar max-h-72 space-y-0.5 overflow-y-auto p-1"
          >
            {back}
            {choice('all', t('allStages'), f.lifecycleStage === '', () =>
              pick({ lifecycleStage: '' }),
            )}
            {p.stages.map((s) =>
              choice(
                s.value,
                s.label,
                f.lifecycleStage === s.value,
                () => pick({ lifecycleStage: s.value }),
                s.color,
              ),
            )}
          </div>
        )}

        {view === 'status' && (
          <div
            role="radiogroup"
            aria-label={t('statusFilter')}
            className="thin-scrollbar max-h-72 space-y-0.5 overflow-y-auto p-1"
          >
            {back}
            {choice('all', t('allStatuses'), f.status === '', () => pick({ status: '' }))}
            {p.statuses.map((s) =>
              choice(
                s.value,
                s.label,
                f.status === s.value,
                () => pick({ status: s.value }),
                s.color,
              ),
            )}
          </div>
        )}

        {view === 'minor' && (
          <div role="radiogroup" aria-label={t('minorFilter')} className="space-y-0.5 p-1">
            {back}
            {choice('all', t('allMinor'), f.minor === '', () => pick({ minor: '' }))}
            {choice('yes', t('minorYes'), f.minor === 'yes', () => pick({ minor: 'yes' }))}
            {choice('no', t('minorNo'), f.minor === 'no', () => pick({ minor: 'no' }))}
          </div>
        )}

        {view === 'consent' && (
          <div role="radiogroup" aria-label={t('consentFilter')} className="space-y-0.5 p-1">
            {back}
            {choice('all', t('allConsent'), f.consent === '', () => pick({ consent: '' }))}
            {choice('subscribed', t('subscribedOnly'), f.consent === 'subscribed', () =>
              pick({ consent: 'subscribed' }),
            )}
            {choice('unsubscribed', t('unsubscribedOnly'), f.consent === 'unsubscribed', () =>
              pick({ consent: 'unsubscribed' }),
            )}
          </div>
        )}

        {view === 'source' && (
          <form
            className="space-y-2 p-1"
            onSubmit={(e) => {
              e.preventDefault();
              pick({ source: source.trim() });
            }}
          >
            {back}
            <label className="block text-xs text-muted-foreground" htmlFor="contacts-source-filter">
              {t('sourceHint')}
            </label>
            <input
              id="contacts-source-filter"
              autoFocus
              value={source}
              maxLength={128}
              onChange={(e) => setSource(e.target.value)}
              placeholder={t('sourcePlaceholder')}
              className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded px-2 py-1 text-xs font-medium text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => {
                  setSource('');
                  pick({ source: '' });
                }}
              >
                {t('filterClear')}
              </button>
              <button
                type="submit"
                className="rounded bg-brand px-3 py-1 text-xs font-medium text-brand-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('filterApply')}
              </button>
            </div>
          </form>
        )}
      </Popover>

      <AdvancedFilter
        value={f.rules}
        onApply={(rules) => p.onChange({ rules })}
        open={builder}
        onOpenChange={setBuilder}
        hideTrigger
      />
    </div>
  );
}
