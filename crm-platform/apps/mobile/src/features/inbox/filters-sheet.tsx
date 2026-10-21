import { useTranslation } from 'react-i18next';
import { FilterPanes, type FilterCategory } from '@/components/ui/filter-panes';
import { messageForError } from '@/lib/api/error-message';
import { FILTER_IDS_MAX, SORTS, STATUS_FILTERS, type InboxFilters } from './filters';
import { useLabelLibrary } from './use-labels';
import { useAssignees, useChannels } from './use-inbox';

/** The part of the filters this screen sets: the tab and the search words are set elsewhere. */
export type SheetFilters = Pick<
  InboxFilters,
  'status' | 'channelId' | 'labels' | 'archived' | 'agentIds' | 'sort'
>;

interface Props {
  visible: boolean;
  value: SheetFilters;
  onApply: (next: SheetFilters) => void;
  onClose: () => void;
}

/**
 * The filter button of the Inbox, laid out like the Geta app: the categories (status, view, channel, labels, agent, sort by) down the
 * left, the choices of the open one on the right, "Clear all" and "Apply" along the bottom. The channels, the labels and the agents are
 * asked for when it opens; a person with none of one sees no such category. The agent filter takes several agents (a conversation
 * assigned to any of them); sorting is the newest activity first (the default) or the oldest first.
 */
/**
 * The ids a category applies. A category the sheet could not offer (its list has not loaded, or failed) is absent from what was picked,
 * and then the filter that was on stays on: pressing Apply after changing only the sort must not widen the list. An empty pick is a
 * real "none". At most `FILTER_IDS_MAX` are kept, the most one request may name.
 */
export const idsApplied = (picked: string | undefined, current: readonly string[]): string[] =>
  picked === undefined ? [...current] : picked ? picked.split(',').slice(0, FILTER_IDS_MAX) : [];

export function FiltersSheet({ visible, value, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const channels = useChannels(visible);
  const labels = useLabelLibrary(visible);
  const agents = useAssignees(visible);

  const categories: FilterCategory[] = [
    {
      key: 'status',
      title: t('inbox.filter.sheet'),
      kind: 'single',
      empty: 'default',
      options: STATUS_FILTERS.map((s) => ({ value: s, label: t(`inbox.statusFilter.${s}`) })),
    },
    {
      key: 'view',
      title: t('inbox.filter.view'),
      kind: 'single',
      empty: 'active',
      options: [
        { value: 'active', label: t('inbox.filter.viewActive') },
        { value: 'archived', label: t('inbox.filter.viewArchived') },
      ],
    },
    ...((channels.data?.data.length ?? 0) > 0
      ? [
          {
            key: 'channel',
            title: t('inbox.filter.channel'),
            kind: 'single' as const,
            options: [
              { value: '', label: t('inbox.filter.allChannels') },
              ...(channels.data?.data ?? []).map((c) => ({
                value: c.id,
                label: c.name,
                hint: c.displayAddress ?? undefined,
              })),
            ],
          },
        ]
      : []),
    ...((labels.data?.length ?? 0) > 0
      ? [
          {
            key: 'labels',
            title: t('inbox.filter.labels'),
            kind: 'multi' as const,
            searchLabel: t('inbox.filter.searchLabels'),
            options: (labels.data ?? []).map((l) => ({ value: l.id, label: l.name })),
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
  ];
  // The extra categories arrive a moment after the screen opens; the list is usable meanwhile, so a failure is only said.
  const loadError = channels.error ?? labels.error ?? agents.error;

  return (
    <FilterPanes
      visible={visible}
      title={t('inbox.filter.title')}
      categories={categories}
      value={{
        status: value.status,
        view: value.archived ? 'archived' : 'active',
        channel: value.channelId,
        labels: value.labels.join(','),
        agents: value.agentIds.join(','),
        sort: value.sort,
      }}
      error={loadError ? messageForError(loadError, t) : null}
      onApply={(picked) =>
        onApply({
          status: (picked.status ?? 'default') as SheetFilters['status'],
          archived: picked.view === 'archived',
          channelId: picked.channel ?? value.channelId,
          labels: idsApplied(picked.labels, value.labels),
          agentIds: idsApplied(picked.agents, value.agentIds),
          sort: (picked.sort ?? 'recent') as SheetFilters['sort'],
        })
      }
      onClose={onClose}
    />
  );
}
