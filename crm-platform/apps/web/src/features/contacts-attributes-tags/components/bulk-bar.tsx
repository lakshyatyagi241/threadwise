'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Popover, Select, Spinner } from '@crm/ui';
import { useGroups } from '../api/groups';
import { sameTagName, TAG_NAME_MAX, useTags } from '../api/tags';
import { errorKind } from '../lib/errors';

type Picker = 'groupAdd' | 'groupRemove' | 'tagAdd' | 'tagRemove' | null;

export interface TagChoice {
  tagId?: string;
  /** A name typed to create (or match) a tag; wins over the select, as in WaDesk. */
  name?: string;
}

export interface BulkBarProps {
  /** Selected rows, or `null` when the selection stands for every contact matching the filter. */
  count: number | null;
  busy: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canExport: boolean;
  canCreateTags: boolean;
  onExport: () => void;
  onDelete: () => void;
  onGroup: (action: 'add' | 'remove', groupId: string) => Promise<boolean>;
  onTag: (action: 'add' | 'remove', choice: TagChoice) => Promise<boolean>;
  onClear: () => void;
}

/** Actions on the selection (WD-CON-019..024). Shown only while something is selected. */
export function BulkBar({
  count,
  busy,
  canUpdate,
  canDelete,
  canExport,
  canCreateTags,
  onExport,
  onDelete,
  onGroup,
  onTag,
  onClear,
}: BulkBarProps) {
  const t = useTranslations('contacts-attributes-tags.bulk');
  const [picker, setPicker] = useState<Picker>(null);
  const close = useCallback(() => setPicker(null), []);

  const btn = 'whitespace-nowrap';
  return (
    <div
      role="toolbar"
      aria-label={t('label')}
      className="relative flex flex-wrap items-center gap-1.5"
    >
      <span className="text-xs text-muted-foreground" aria-live="polite">
        {count === null ? t('allMatching') : t('selected', { count })}
      </span>
      {canExport && (
        <Button variant="secondary" size="sm" className={btn} onClick={onExport} disabled={busy}>
          {t('export')}
        </Button>
      )}
      {canUpdate && (
        <>
          <Button
            variant="secondary"
            size="sm"
            className={btn}
            onClick={() => setPicker('groupAdd')}
            disabled={busy}
          >
            {t('addToGroup')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={btn}
            onClick={() => setPicker('groupRemove')}
            disabled={busy}
          >
            {t('removeFromGroup')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={btn}
            onClick={() => setPicker('tagAdd')}
            disabled={busy}
          >
            {t('tag')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={btn}
            onClick={() => setPicker('tagRemove')}
            disabled={busy}
          >
            {t('untag')}
          </Button>
        </>
      )}
      {canDelete && (
        <Button
          variant="secondary"
          size="sm"
          className={`${btn} border-danger text-danger hover:bg-danger/10`}
          onClick={onDelete}
          disabled={busy}
        >
          {t('delete')}
        </Button>
      )}
      {busy && <Spinner label={t('working')} />}
      <Button variant="ghost" size="sm" className={btn} onClick={onClear} disabled={busy}>
        {t('clear')}
      </Button>

      <GroupPicker
        open={picker === 'groupAdd' || picker === 'groupRemove'}
        action={picker === 'groupRemove' ? 'remove' : 'add'}
        onClose={close}
        onApply={async (action, id) => {
          const ok = await onGroup(action, id);
          if (ok) close();
        }}
      />
      <TagPicker
        open={picker === 'tagAdd' || picker === 'tagRemove'}
        action={picker === 'tagRemove' ? 'remove' : 'add'}
        canCreate={canCreateTags}
        onClose={close}
        onApply={async (action, choice) => {
          const ok = await onTag(action, choice);
          if (ok) close();
        }}
      />
    </div>
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
  onApply: (action: 'add' | 'remove', choice: TagChoice) => Promise<void>;
}) {
  const t = useTranslations('contacts-attributes-tags.bulk');
  const tags = useTags(open);
  const [tagId, setTagId] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<'pick' | 'none' | null>(null);
  const [pending, setPending] = useState(false);
  const list = tags.data ?? [];
  const chosen = tagId || list[0]?.id || '';

  async function apply() {
    const typed = action === 'add' ? name.trim() : '';
    if (action === 'remove' && list.length === 0) return setProblem('none');
    if (!typed && !chosen) return setProblem('pick');
    setProblem(null);
    setPending(true);
    try {
      // Typing a name that already exists reuses that tag.
      const existing = typed ? list.find((x) => sameTagName(x.name, typed)) : undefined;
      await onApply(
        action,
        typed && !existing ? { name: typed } : { tagId: existing?.id ?? chosen },
      );
      setName('');
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover open={open} onClose={onClose} label={action === 'add' ? t('addTag') : t('removeTag')}>
      <div className="text-xs font-semibold">{action === 'add' ? t('addTag') : t('removeTag')}</div>
      {list.length > 0 ? (
        <Select
          aria-label={t('tagSelect')}
          value={chosen}
          onChange={(e) => setTagId(e.target.value)}
        >
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.contactCount === undefined ? x.name : `${x.name} (${x.contactCount})`}
            </option>
          ))}
        </Select>
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
