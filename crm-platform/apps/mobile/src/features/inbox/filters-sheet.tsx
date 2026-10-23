import { useTranslation } from 'react-i18next';
import { FilterPanes, type FilterCategory } from '@/components/ui/filter-panes';
import { messageForError } from '@/lib/api/error-message';
import {
  ASSIGNMENTS,
  FILTER_IDS_MAX,
  SORTS,
  STATUS_CHOICES,
  type AssignmentFilter,
  type InboxFilters,
  type StatusChoice,
} from './filters';
import { useLabelLibrary } from './use-labels';
import { useAssignees, useChannels } from './use-inbox';

/** The part of the filters this screen sets: the tab and the search words are set elsewhere. */
export type SheetFilters = Pick<
  InboxFilters,
  | 'statuses'
  | 'assignment'
  | 'channelIds'
  | 'labels'
  | 'archived'
  | 'agentIds'
  | 'sort'
  | 'from'
  | 'to'
>;

const today = (): string => new Date().toISOString().slice(0, 10);

interface Props {
  visible: boolean;
  value: SheetFilters;
  onApply: (next: SheetFilters) => void;
  onClose: () => void;
}

/**
 * The ids a category applies. A category the sheet could not offer (its list has not loaded, or failed) is absent from what was picked,
 * and then the filter that was on stays on: pressing Apply after changing only the sort must not widen the list. An empty pick is a
 * real "none". At most `FILTER_IDS_MAX` are kept, the most one request may name.
 */
export const idsApplied = (picked: string | undefined, current: readonly string[]): string[] =>
  picked === undefined ? [...current] : picked ? picked.split(',').slice(0, FILTER_IDS_MAX) : [];

/** The statuses ticked, kept to the ones the window offers, in the order it lists them. */
const statusesApplied = (picked: string | undefined): StatusChoice[] => {
  const ticked = new Set((picked ?? '').split(','));
  return STATUS_CHOICES.filter((s) => ticked.has(s));
};

const assignmentApplied = (picked: string | undefined): AssignmentFilter =>
  (ASSIGNMENTS as readonly string[]).includes(picked ?? '') ? (picked as AssignmentFilter) : '';

/**
 * The filter button of the Inbox, laid out like the Geta app, with the same filters as the web's Filters window: the categories (chat
 * status, conversation, sort by, date range, tags, channels, agents) down the left, the choices of the open one on the right, "Clear all" and "Apply" along the bottom. The channels, the labels and the agents are
 * asked for when it opens; a person with none of one sees no such category. The status, channel, label and agent filters take
 * several choices (a conversation in or on any of them); sorting is the newest activity first (the default) or the oldest first.
 */
export function FiltersSheet({ visible, value, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const channels = useChannels(visible);
  const labels = useLabelLibrary(visible);
  const agents = useAssignees(visible);

  const categories: FilterCategory[] = [
    {
      key: 'status',
      title: t('inbox.filter.sheet'),
      kind: 'multi',
      options: STATUS_CHOICES.map((s) => ({ value: s, label: t(`inbox.statusFilter.${s}`) })),
    },
    {
      key: 'assignment',
      title: t('inbox.filter.conversation'),
      kind: 'single',
      empty: 'any',
      options: [
        { value: 'any', label: t('inbox.filter.conversationAny') },
        ...ASSIGNMENTS.map((a) => ({ value: a, label: t(`inbox.filter.conversation_${a}`) })),
      ],
    },
    {
      key: 'sort',
      title: t('inbox.filter.sort'),
      kind: 'single',
      empty: 'recent',
      options: SORTS.map((value) => ({
        value,
        label: t(`inbox.filter.sort_${value}`),
        // The oldest-first order ignores pins (the API's rule): say so, or it looks as if pinning stopped working.
        hint: value === 'old' ? t('inbox.filter.sortOldHint') : undefined,
      })),
    },
    { key: 'dates', title: t('inbox.filter.dates'), kind: 'dates', maxDate: today() },
    ...((labels.data?.length ?? 0) > 0
      ? [
          {
            key: 'labels',
            title: t('inbox.filter.tags'),
            kind: 'multi' as const,
            searchLabel: t('inbox.filter.searchTags'),
            options: (labels.data ?? []).map((l) => ({ value: l.id, label: l.name })),
          },
        ]
      : []),
    ...((channels.data?.data.length ?? 0) > 0
      ? [
          {
            key: 'channels',
            title: t('inbox.filter.channel'),
            kind: 'multi' as const,
            options: (channels.data?.data ?? []).map((c) => ({
              value: c.id,
              label: c.name,
              hint: c.displayAddress ?? undefined,
            })),
          },
        ]
      : []),
    ...((agents.data?.users.length ?? 0) > 0
      ? [
          {
            key: 'agents',
            title: t('inbox.filter.agent'),
            kind: 'multi' as const,
            searchLabel: t('inbox.filter.searchAgents'),
            options: (agents.data?.users ?? []).map((m) => ({
              value: m.id,
              label: m.name ?? m.email,
              hint: m.isMe ? t('inbox.filter.me') : undefined,
            })),
          },
        ]
      : []),
  ];
  // The extra categories arrive a moment after the screen opens; the list is usable meanwhile, so a failure is only said.
  const loadError = channels.error ?? labels.error ?? agents.error;

  return (
    <FilterPanes
      visible={visible}
      title={t('inbox.filter.title')}
      categories={categories}
      value={{
        status: value.statuses.join(','),
        assignment: value.assignment || 'any',
        sort: value.sort,
        dates: value.from || value.to ? `${value.from},${value.to}` : '',
        labels: value.labels.join(','),
        channels: value.channelIds.join(','),
        agents: value.agentIds.join(','),
      }}
      error={loadError ? messageForError(loadError, t) : null}
      onApply={(picked) => {
        const [from, to] = (picked.dates ?? '').split(',');
        onApply({
          statuses: statusesApplied(picked.status),
          assignment: assignmentApplied(picked.assignment),
          sort: (picked.sort ?? 'recent') as SheetFilters['sort'],
          from: from ?? '',
          to: to ?? '',
          labels: idsApplied(picked.labels, value.labels),
          channelIds: idsApplied(picked.channels, value.channelIds),
          agentIds: idsApplied(picked.agents, value.agentIds),
          // The window no longer offers the archive view; whatever was on stays as it was.
          archived: value.archived,
        });
      }}
      onClose={onClose}
    />
  );
}
