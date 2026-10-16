'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button, Modal, cn } from '@crm/ui';
import {
  CONVERSATION_STATUSES,
  INBOX_ASSIGNMENT_FILTERS,
  INBOX_SORTS,
  type ChannelResponse,
  type ConversationStatus,
} from '@crm/contracts';
import { useAssignees, useTags } from '../api/hooks';
import { DEFAULT_FILTERS, type ListFilters } from '../lib/list';
import { DateRangePicker } from './date-range-picker';
import { MultiSelect } from './multi-select';
import { TagChip } from './tag-chip';

/** The statuses the window offers: Resolved stands for resolved and closed, as everywhere else in the inbox. Spam is not offered: nothing in the inbox marks a thread as spam. */
const STATUS_CHOICES = CONVERSATION_STATUSES.filter((s) => s !== 'closed' && s !== 'spam');

/** What the window edits: the filters it owns (not the search text, the tab or the archive view). */
type Draft = Pick<
  ListFilters,
  | 'statuses'
  | 'assignment'
  | 'tags'
  | 'tagScope'
  | 'channelIds'
  | 'agentIds'
  | 'sort'
  | 'from'
  | 'to'
>;

function draftOf(f: ListFilters): Draft {
  // A single status picked in the list's own status box (Snoozed, say) shows as chosen here.
  const statuses: ConversationStatus[] =
    f.statuses.length > 0
      ? f.statuses
      : f.status !== 'open' && f.status !== 'all'
        ? [f.status === 'closed' ? 'resolved' : f.status]
        : [];
  return {
    statuses,
    assignment: f.assignment,
    tags: f.tags,
    tagScope: f.tagScope,
    // The list's own channel box (one channel) shows here as a choice too.
    channelIds: f.channelIds.length > 0 ? f.channelIds : f.channelId ? [f.channelId] : [],
    agentIds: f.agentIds,
    sort: f.sort,
    from: f.from,
    to: f.to,
  };
}

export interface FiltersDialogProps {
  open: boolean;
  onClose: () => void;
  filters: ListFilters;
  onApply: (patch: Partial<ListFilters>) => void;
  channels: ChannelResponse[] | undefined;
}

/**
 * The Filters window (a popup over the inbox): Chat Status (several at once), Conversation (assigned, unassigned or unattended),
 * Labels, Channels, Agents, Sort By and a Date Range of the last activity. Nothing changes until **Apply**; **Reset** clears all of
 * it. The list's own boxes for status, tags and channel stay and edit the same filters.
 */
export function FiltersDialog(props: FiltersDialogProps) {
  // The draft is rebuilt each time the window opens, so a closed window never keeps a half-made choice.
  return props.open ? <FiltersBody {...props} /> : null;
}

function FiltersBody({ onClose, filters, onApply, channels }: FiltersDialogProps) {
  const t = useTranslations('team-inbox-conversations.list');
  const f = useTranslations('team-inbox-conversations.list.filters');
  const [d, setD] = useState<Draft>(() => draftOf(filters));
  const tags = useTags(true);
  const assignees = useAssignees(true);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const toggle = <T extends string>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const people = assignees.data?.users ?? [];
  const library = tags.data?.data ?? [];
  // Email mailboxes have their own entry in the list's channel box; the window offers the chat channels.
  const visibleChannels = (channels ?? []).filter((c) => c.kind !== 'email');

  function apply() {
    onApply({
      ...d,
      // The multi-select replaces the list's single status box.
      status: DEFAULT_FILTERS.status,
      channelId: null,
    });
    onClose();
  }

  const chip = (on: boolean) =>
    cn(
      'rounded-full border px-3 py-1 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-primary',
      on
        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
        : 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground',
    );

  const section = (title: string, children: ReactNode, hint?: string) => (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </section>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={f('title')}
      closeLabel={f('close')}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => setD(draftOf({ ...DEFAULT_FILTERS }))}>
            {f('reset')}
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {f('cancel')}
            </Button>
            <Button onClick={apply} data-testid="inbox-filters-apply">
              {f('apply')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2" data-testid="inbox-filters-dialog">
        <div className="space-y-6">
          {section(
            f('status'),
            <div role="group" aria-label={f('status')} className="flex flex-wrap gap-1.5">
              {STATUS_CHOICES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={d.statuses.includes(s)}
                  data-testid={`inbox-filters-status-${s}`}
                  onClick={() => set({ statuses: toggle(d.statuses, s) })}
                  className={chip(d.statuses.includes(s))}
                >
                  {t(`status.${s}`)}
                </button>
              ))}
            </div>,
            d.statuses.length === 0 ? f('statusHint') : undefined,
          )}

          {section(
            f('conversation'),
            <div role="group" aria-label={f('conversation')} className="flex flex-wrap gap-1.5">
              {([null, ...INBOX_ASSIGNMENT_FILTERS] as const).map((a) => (
                <button
                  key={a ?? 'any'}
                  type="button"
                  aria-pressed={d.assignment === a}
                  data-testid={`inbox-filters-conversation-${a ?? 'any'}`}
                  onClick={() => set({ assignment: a })}
                  className={chip(d.assignment === a)}
                >
                  {f(a ?? 'any')}
                </button>
              ))}
            </div>,
          )}

          {section(
            f('sortBy'),
            <div
              role="group"
              aria-label={f('sortBy')}
              className="inline-grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5 text-xs"
            >
              {INBOX_SORTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={d.sort === s}
                  data-testid={`inbox-filters-sort-${s}`}
                  onClick={() => set({ sort: s })}
                  className={cn(
                    'rounded-md px-5 py-1.5 font-medium focus-visible:ring-2 focus-visible:ring-primary',
                    d.sort === s
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f(s)}
                </button>
              ))}
            </div>,
          )}

          {section(
            f('dateRange'),
            <DateRangePicker from={d.from} to={d.to} onChange={(r) => set(r)} />,
          )}
        </div>

        <div className="space-y-6">
          {library.length > 0 &&
            section(
              f('labels'),
              <MultiSelect
                label={f('labels')}
                testId="inbox-filters-labels"
                placeholder={f('select')}
                searchLabel={f('search')}
                emptyText={f('noMatch')}
                value={d.tags}
                onChange={(tags) => set({ tags })}
                options={library.map((l) => ({
                  id: l.id,
                  label: l.name,
                  render: <TagChip tag={l} className="max-w-[12rem] text-xs" />,
                }))}
              />,
            )}

          {visibleChannels.length > 0 &&
            section(
              f('channels'),
              <MultiSelect
                label={f('channels')}
                testId="inbox-filters-channels"
                placeholder={f('select')}
                searchLabel={f('search')}
                emptyText={f('noMatch')}
                value={d.channelIds}
                onChange={(channelIds) => set({ channelIds })}
                options={visibleChannels.map((c) => ({ id: c.id, label: c.name }))}
              />,
            )}

          {people.length > 0 &&
            section(
              f('agents'),
              <MultiSelect
                label={f('agents')}
                testId="inbox-filters-agents"
                placeholder={f('select')}
                searchLabel={f('search')}
                emptyText={f('noMatch')}
                value={d.agentIds}
                onChange={(agentIds) => set({ agentIds })}
                options={people.map((u) => ({ id: u.id, label: u.name ?? u.email }))}
              />,
            )}
        </div>
      </div>
    </Modal>
  );
}
