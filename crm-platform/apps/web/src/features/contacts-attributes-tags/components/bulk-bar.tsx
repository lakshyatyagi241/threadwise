'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Checkbox, Input, Popover, Select, Spinner } from '@crm/ui';
import { useGroups } from '../api/groups';
import { sameTagName, TAG_NAME_MAX, useTags } from '../api/tags';
import { errorKind } from '../lib/errors';

export interface TagChoice {
  tagId?: string;
  /** A name typed to create (or match) a tag; wins over the select, as in Reference. */
  name?: string;
}

/** Which bulk picker is open (they open from the "More actions" menu). */
export type BulkPicker = 'groupAdd' | 'groupRemove' | 'tagAdd' | 'tagRemove' | null;

/**
 * The group and tag pickers of the bulk actions (TW-CON-019..024). They are popovers anchored to the "More actions"
 * button: the menu item sets `picker`, and applying (or cancelling) closes it.
 */
export function BulkPickers({
  picker,
  canCreateTags,
  onClose,
  onGroup,
  onTag,
}: {
  picker: BulkPicker;
  canCreateTags: boolean;
  onClose: () => void;
  onGroup: (action: 'add' | 'remove', groupId: string) => Promise<boolean>;
  onTag: (action: 'add' | 'remove', choices: TagChoice[]) => Promise<boolean>;
}) {
  return (
    <>
      <GroupPicker
        open={picker === 'groupAdd' || picker === 'groupRemove'}
        action={picker === 'groupRemove' ? 'remove' : 'add'}
        onClose={onClose}
        onApply={async (action, id) => {
          if (await onGroup(action, id)) onClose();
        }}
      />
      <TagPicker
        open={picker === 'tagAdd' || picker === 'tagRemove'}
        action={picker === 'tagRemove' ? 'remove' : 'add'}
        canCreate={canCreateTags}
        onClose={onClose}
        onApply={async (action, choices) => {
          if (await onTag(action, choices)) onClose();
        }}
      />
    </>
  );
}

function GroupPicker({
  open,
  action,
  onClose,
  onApply,
}: {
  open: boolean;
  action: 'add' | 'remove';
  onClose: () => void;
  onApply: (action: 'add' | 'remove', groupId: string) => Promise<void>;
}) {
  const t = useTranslations('contacts-attributes-tags.bulk');
  const groups = useGroups();
  const [groupId, setGroupId] = useState('');
  const [pending, setPending] = useState(false);
  const list = groups.data ?? [];
  const chosen = groupId || list[0]?.id || '';

  return (
    <Popover
      open={open}
      onClose={onClose}
      label={action === 'add' ? t('addToGroup') : t('removeFromGroup')}
    >
      <div className="text-xs font-semibold">
        {action === 'add' ? t('addToGroup') : t('removeFromGroup')}
      </div>
      {groups.isError ? (
        <p className="text-sm text-muted-foreground">
          {errorKind(groups.error) === 'unavailable' ? t('groupsUnavailable') : t('groupsFailed')}
        </p>
      ) : list.length === 0 && !groups.isPending ? (
        <p className="text-sm text-muted-foreground">{t('createGroupFirst')}</p>
      ) : (
        <Select
          aria-label={t('group')}
          value={chosen}
          onChange={(e) => setGroupId(e.target.value)}
          disabled={groups.isPending}
        >
          {list.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button
          size="sm"
          disabled={!chosen || pending}
          onClick={async () => {
            setPending(true);
            try {
              await onApply(action, chosen);
            } finally {
              setPending(false);
            }
          }}
        >
          {pending && <Spinner />}
          {t('apply')}
        </Button>
      </div>
    </Popover>
  );
}

function TagPicker({
  open,
  action,
  canCreate,
  onClose,
  onApply,
}: {
  open: boolean;
  action: 'add' | 'remove';
  canCreate: boolean;
  onClose: () => void;
  onApply: (action: 'add' | 'remove', choices: TagChoice[]) => Promise<void>;
}) {
  const t = useTranslations('contacts-attributes-tags.bulk');
  const tags = useTags(open);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<'pick' | 'none' | null>(null);
  const [pending, setPending] = useState(false);
  const list = tags.data ?? [];

  async function apply() {
    const typed = action === 'add' ? name.trim() : '';
    if (action === 'remove' && list.length === 0) return setProblem('none');
    if (!typed && picked.length === 0) return setProblem('pick');
    setProblem(null);
    setPending(true);
    try {
      const choices: TagChoice[] = picked.map((tagId) => ({ tagId }));
      // Typing a name that already exists reuses that tag.
      if (typed) {
        const existing = list.find((x) => sameTagName(x.name, typed));
        if (existing) {
          if (!picked.includes(existing.id)) choices.push({ tagId: existing.id });
        } else {
          choices.push({ name: typed });
        }
      }
      await onApply(action, choices);
      setName('');
      setPicked([]);
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover open={open} onClose={onClose} label={action === 'add' ? t('addTag') : t('removeTag')}>
      <div className="text-xs font-semibold">{action === 'add' ? t('addTag') : t('removeTag')}</div>
      {list.length > 0 ? (
        <ul aria-label={t('tagSelect')} className="thin-scrollbar max-h-48 space-y-1 overflow-auto">
          {list.map((x) => (
            <li key={x.id}>
              <Checkbox
                label={x.contactCount === undefined ? x.name : `${x.name} (${x.contactCount})`}
                checked={picked.includes(x.id)}
                onChange={() =>
                  setPicked((cur) =>
                    cur.includes(x.id) ? cur.filter((id) => id !== x.id) : [...cur, x.id],
                  )
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {tags.isPending ? t('loading') : action === 'add' ? t('noTagsType') : t('noTagsToRemove')}
        </p>
      )}
      {action === 'add' && canCreate && (
        <Input
          value={name}
          maxLength={TAG_NAME_MAX}
          placeholder={t('newTagPlaceholder')}
          aria-label={t('newTagLabel')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void apply();
            }
          }}
        />
      )}
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem === 'none' ? t('noTagsToRemove') : t('pickOrType')}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button size="sm" disabled={pending} onClick={() => void apply()}>
          {pending && <Spinner />}
          {t('apply')}
        </Button>
      </div>
    </Popover>
  );
}
