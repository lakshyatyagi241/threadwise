import { useTranslation } from 'react-i18next';
import { messageForError } from '@/lib/api/error-message';
import { ChoiceSheet, type ChoiceGroup } from './choice-sheet';
import { STATUS_FILTERS, type InboxFilters } from './filters';
import { useLabelLibrary } from './use-labels';
import { useChannels } from './use-inbox';

/** The part of the filters this sheet sets: the tab and the search words are set elsewhere. */
export type SheetFilters = Pick<InboxFilters, 'status' | 'channelId' | 'labels' | 'archived'>;

interface Props {
  visible: boolean;
  value: SheetFilters;
  onApply: (next: SheetFilters) => void;
  onClose: () => void;
}

/**
 * The filter button of the Inbox: narrow the list by status, channel and labels, or switch to the archive. Pick, then Save. The
 * channels and the labels are asked for when the sheet opens; a person with none of either sees no such group.
 */
export function FiltersSheet({ visible, value, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const channels = useChannels(visible);
  const labels = useLabelLibrary(visible);

  const groups: ChoiceGroup[] = [
    {
      key: 'status',
      title: t('inbox.filter.sheet'),
      options: STATUS_FILTERS.map((s) => ({ value: s, label: t(`inbox.statusFilter.${s}`) })),
    },
    {
      key: 'view',
      title: t('inbox.filter.view'),
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
            multiple: true,
            options: (labels.data ?? []).map((l) => ({ value: l.id, label: l.name })),
          },
        ]
      : []),
  ];
  const initial = {
    status: value.status,
    view: value.archived ? 'archived' : 'active',
    channel: value.channelId,
    labels: value.labels.join(','),
  };
  // The extra groups arrive a moment after the sheet opens; the list is usable meanwhile, so a failure is only said, not blocking.
  const loadError = channels.error ?? labels.error;

  return (
    <ChoiceSheet
      visible={visible}
      title={t('inbox.filter.title')}
      groups={groups}
      initial={initial}
      loading={false}
      loadError={null}
      saving={false}
      error={loadError ? messageForError(loadError, t) : null}
      onSave={(picked) =>
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
