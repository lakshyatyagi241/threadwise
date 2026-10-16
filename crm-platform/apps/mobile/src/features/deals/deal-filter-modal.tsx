import type { DealSource, DealStatus } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { FilterPanes, type FilterCategory } from '@/components/ui/filter-panes';
import { can, useSession } from '@/lib/session/use-session';
import { DEAL_SOURCES, OWNER_MINE, OWNER_NONE, STATUS_CHOICES, type DealChoices } from './filters';
import { useAssignees } from './use-deals';

interface Props {
  choices: DealChoices;
  /** The list view has a status filter; the board's columns are the statuses, so it does not. */
  listView: boolean;
  onApply: (choices: DealChoices) => void;
  onClose: () => void;
}

/**
 * The filters of the deals, laid out like the contact filters: the categories down the left (owner, source and, in the list view,
 * status), the choices of the open one on the right. Nothing changes on the screen until "Apply"; the screen mounts it only
 * while open, so it starts from what is applied.
 */
export function DealFilterModal({ choices, listView, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const session = useSession();
  const people = useAssignees(can(session.data, 'record.contacts.read'));

  const categories: FilterCategory[] = [
    {
      key: 'owner',
      title: t('deals.filter.owner'),
      kind: 'single',
      options: [
        { value: '', label: t('deals.filter.any') },
        { value: OWNER_MINE, label: t('deals.filter.mine') },
        { value: OWNER_NONE, label: t('deals.filter.unassigned') },
        ...(people.data ?? [])
          .filter((p) => p.id !== session.data?.user.id)
          .map((p) => ({ value: p.id, label: p.fullName, hint: p.email })),
      ],
    },
    {
      key: 'source',
      title: t('deals.filter.source'),
      kind: 'single',
      options: [
        { value: '', label: t('deals.filter.any') },
        ...DEAL_SOURCES.map((source) => ({ value: source, label: t(`deals.source.${source}`) })),
      ],
    },
    ...(listView
      ? ([
          {
            key: 'status',
            title: t('deals.filter.status'),
            kind: 'single',
            options: [
              { value: '', label: t('deals.filter.any') },
              ...STATUS_CHOICES.map((status) => ({
                value: status,
                label: t(`deals.status.${status}`),
              })),
            ],
          },
        ] satisfies FilterCategory[])
      : []),
  ];

  return (
    <FilterPanes
      visible
      title={t('deals.filter.title')}
      categories={categories}
      value={{
        owner: choices.owner ?? '',
        source: choices.source ?? '',
        status: choices.status ?? '',
      }}
      error={people.isError ? t('deals.filter.ownersFailed') : null}
      onApply={(picked) =>
        onApply({
          ...(picked.owner ? { owner: picked.owner } : {}),
          ...(picked.source ? { source: picked.source as DealSource } : {}),
          // The status filter belongs to the list view: kept as it was when the person is on the board.
          ...(listView
            ? picked.status
              ? { status: picked.status as DealStatus }
              : {}
            : choices.status
              ? { status: choices.status }
              : {}),
        })
      }
      onClose={onClose}
    />
  );
}
