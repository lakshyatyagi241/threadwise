import { useTranslation } from 'react-i18next';
import { FilterPanes, type FilterCategory } from '@/components/ui/filter-panes';
import { can, useSession } from '@/lib/session/use-session';
import type { ContactFilters } from './api';
import { LIFECYCLE_STAGES, cleanFilters } from './filters';
import { STAGE_GROUP, optionsOfGroup } from './property-values';
import { useAssignees, useStatusOptions } from './use-properties';

interface Props {
  filters: ContactFilters;
  onApply: (filters: ContactFilters) => void;
  onClose: () => void;
}

/** The owner list's own value for "contacts with no owner" (a person's id is a uuid, so it cannot clash). */
const NO_OWNER = 'none';

/** The marketing choice as a word, since the API takes a yes/no/unset flag. */
type Marketing = 'all' | 'subscribed' | 'unsubscribed';
const toMarketing = (v: boolean | undefined): Marketing =>
  v === undefined ? 'all' : v ? 'unsubscribed' : 'subscribed';
const fromMarketing = (m: string): boolean | undefined =>
  m === 'unsubscribed' ? true : m === 'subscribed' ? false : undefined;

/** Today as YYYY-MM-DD in UTC, the last day the created-date calendar offers. */
const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * The filters the contact list offers, laid out like the Geta app: the categories (owner, lifecycle stage, created date, source,
 * marketing) down the left, the choices of the open one on the right, "Clear all" and "Apply" along the bottom. The screen mounts
 * it only while open, so it starts from what is applied; nothing changes on the list until "Apply".
 */
export function FilterModal({ filters, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const session = useSession();
  const people = useAssignees(can(session.data, 'record.contacts.read'));
  const workspaceStages = optionsOfGroup(
    useStatusOptions(can(session.data, 'record.contact-properties.read')).data ?? [],
    [STAGE_GROUP],
  );

  const stages =
    workspaceStages.length > 0
      ? workspaceStages.map((o) => ({ value: o.value, label: o.label }))
      : LIFECYCLE_STAGES.map((stage) => ({ value: stage, label: t(`contacts.stage.${stage}`) }));

  const categories: FilterCategory[] = [
    {
      key: 'owner',
      title: t('contacts.filter.owner'),
      kind: 'multi',
      searchLabel: t('contacts.filter.ownerSearch'),
      options: [
        { value: NO_OWNER, label: t('contacts.filter.unassigned') },
        ...(people.data ?? []).map((p) => ({ value: p.id, label: p.fullName, hint: p.email })),
      ],
    },
    {
      key: 'stage',
      title: t('contacts.filter.stage'),
      kind: 'single',
      options: [{ value: '', label: t('contacts.filter.any') }, ...stages],
    },
    { key: 'created', title: t('contacts.filter.created'), kind: 'dates', maxDate: today() },
    {
      key: 'source',
      title: t('contacts.filter.source'),
      kind: 'text',
      label: t('contacts.filter.source'),
      hint: t('contacts.filter.sourceHint'),
    },
    {
      key: 'marketing',
      title: t('contacts.filter.marketing'),
      kind: 'single',
      empty: 'all',
      options: (['all', 'subscribed', 'unsubscribed'] as const).map((value) => ({
        value,
        label: t(`contacts.filter.marketingOptions.${value}`),
      })),
    },
  ];

  const owners = [
    ...(filters.unassigned ? [NO_OWNER] : []),
    ...(filters.ownerIds ? filters.ownerIds.split(',') : []),
  ];
  return (
    <FilterPanes
      visible
      title={t('contacts.filter.title')}
      categories={categories}
      value={{
        owner: owners.join(','),
        stage: filters.lifecycleStage ?? '',
        created: `${filters.createdFrom ?? ''},${filters.createdTo ?? ''}`,
        source: filters.source ?? '',
        marketing: toMarketing(filters.unsubscribed),
      }}
      onApply={(picked) => {
        const chosen = picked.owner ? picked.owner.split(',') : [];
        const [createdFrom, createdTo] = (picked.created ?? '').split(',');
        onApply(
          cleanFilters({
            q: filters.q,
            ownerIds: chosen.filter((id) => id !== NO_OWNER).join(','),
            unassigned: chosen.includes(NO_OWNER) ? true : undefined,
            lifecycleStage: picked.stage || undefined,
            createdFrom: createdFrom || undefined,
            createdTo: createdTo || undefined,
            source: picked.source,
            unsubscribed: fromMarketing(picked.marketing ?? 'all'),
          }),
        );
      }}
      onClose={onClose}
    />
  );
}
