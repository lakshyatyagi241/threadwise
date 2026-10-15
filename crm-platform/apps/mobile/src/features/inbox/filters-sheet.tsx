import { useTranslation } from 'react-i18next';
import { FilterPanes, type FilterCategory } from '@/components/ui/filter-panes';
import { messageForError } from '@/lib/api/error-message';
import { STATUS_FILTERS, type InboxFilters } from './filters';
import { useLabelLibrary } from './use-labels';
import { useChannels } from './use-inbox';

/** The part of the filters this screen sets: the tab and the search words are set elsewhere. */
export type SheetFilters = Pick<InboxFilters, 'status' | 'channelId' | 'labels' | 'archived'>;

interface Props {
  visible: boolean;
  value: SheetFilters;
  onApply: (next: SheetFilters) => void;
  onClose: () => void;
}

/**
 * The filter button of the Inbox, laid out like the Geta app: the categories (status, view, channel, labels) down the left, the
 * choices of the open one on the right, "Clear all" and "Apply" along the bottom. The channels and the labels are asked for when
 * it opens; a person with none of either sees no such category. Filtering by agent and sorting wait for the API: the list route
 * has no parameter for either yet.
 */
export function FiltersSheet({ visible, value, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const channels = useChannels(visible);
  const labels = useLabelLibrary(visible);

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
  ];
  // The extra categories arrive a moment after the screen opens; the list is usable meanwhile, so a failure is only said.
  const loadError = channels.error ?? labels.error;

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
      }}
      error={loadError ? messageForError(loadError, t) : null}
      onApply={(picked) =>
        onApply({
          status: (picked.status ?? 'default') as SheetFilters['status'],
          archived: picked.view === 'archived',
          channelId: picked.channel ?? '',
          labels: picked.labels ? picked.labels.split(',') : [],
        })
      }
      onClose={onClose}
    />
  );
}
