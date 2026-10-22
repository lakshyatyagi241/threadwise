import { useTranslation } from 'react-i18next';
import { FilterPanes, type FilterCategory } from '@/components/ui/filter-panes';
import {
  DEFAULT_STATUS,
  DUE_CHOICES,
  OWNER_CHOICES,
  PRIORITY_CHOICES,
  STATUS_CHOICES,
  cleanChoices,
  defaultOwner,
  type OwnerChoice,
  type StatusChoice,
  type TaskChoices,
} from './filters';

interface Props {
  choices: TaskChoices;
  /** The contact whose tasks are listed, or '' for My tasks: it decides which owner is the default. */
  contactId: string;
  onApply: (choices: TaskChoices) => void;
  onClose: () => void;
}

/**
 * The filters of the task list, laid out like the Geta app's and like the contact and deal filters: the categories (status,
 * priority, due, owner) down the left, the choices of the open one on the right, "Clear all" and "Apply" along the bottom. One
 * choice each; status and owner always hold a real value (open and mine, or all on a contact's list, are their defaults), priority
 * and due can be left on "Any". Nothing changes on the list until "Apply"; "Clear all" takes every filter off and applies at once. The screen
 * mounts it fresh each time it opens, so it starts from what is applied.
 */
export function TaskFilterModal({ choices, contactId, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const ownerDefault = defaultOwner(contactId);
  const any = { value: '', label: t('tasks.filter.any') };

  const categories: FilterCategory[] = [
    {
      key: 'status',
      title: t('tasks.filter.group.status'),
      kind: 'single',
      empty: DEFAULT_STATUS,
      options: STATUS_CHOICES.map((value) => ({
        value,
        label: t(`tasks.filter.status.${value}`),
      })),
    },
    {
      key: 'priority',
      title: t('tasks.filter.group.priority'),
      kind: 'single',
      options: [
        any,
        ...PRIORITY_CHOICES.map((value) => ({ value, label: t(`tasks.priority.${value}`) })),
      ],
    },
    {
      key: 'due',
      title: t('tasks.filter.group.due'),
      kind: 'single',
      options: [
        any,
        ...DUE_CHOICES.map((value) => ({ value, label: t(`tasks.filter.due.${value}`) })),
      ],
    },
    {
      key: 'owner',
      title: t('tasks.filter.group.owner'),
      kind: 'single',
      empty: ownerDefault,
      options: OWNER_CHOICES.map((value) => ({
        value,
        label: t(`tasks.filter.owner.${value}`),
      })),
    },
  ];

  return (
    <FilterPanes
      visible
      title={t('tasks.filter.title')}
      categories={categories}
      value={{
        status: choices.status ?? DEFAULT_STATUS,
        priority: choices.priority ?? '',
        due: choices.due ?? '',
        owner: choices.owner ?? ownerDefault,
      }}
      onApply={(picked) =>
        onApply(
          cleanChoices(
            {
              status: picked.status as StatusChoice,
              owner: picked.owner as OwnerChoice,
              ...(picked.priority ? { priority: picked.priority as TaskChoices['priority'] } : {}),
              ...(picked.due ? { due: picked.due as TaskChoices['due'] } : {}),
            },
            contactId,
          ),
        )
      }
      onClose={onClose}
    />
  );
}
