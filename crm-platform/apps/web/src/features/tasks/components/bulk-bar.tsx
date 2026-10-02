'use client';

import { useTranslations } from 'next-intl';
import { Button, Menu, MenuItem, MenuLabel, MenuSeparator, Spinner } from '@crm/ui';
import type { Member } from '../api/schemas';
import { CheckIcon, TrashIcon, UsersIcon } from './icons';

export interface BulkBarProps {
  count: number;
  busy: boolean;
  members: readonly Member[];
  meId: string;
  canUpdate: boolean;
  canDelete: boolean;
  onComplete: () => void;
  onAssign: (assigneeId: string | null) => void;
  onDelete: () => void;
  onClear: () => void;
}

/** Appears over the table while rows are ticked: complete, assign to someone, delete. */
export function BulkBar(p: BulkBarProps) {
  const t = useTranslations('tasks.bulk');
  return (
    <div
      role="region"
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-2 rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-sm"
    >
      <span className="font-medium" aria-live="polite">
        {t('selected', { count: p.count })}
      </span>
      {p.busy && <Spinner label={t('working')} />}
      {p.canUpdate && (
        <>
          <Button size="sm" variant="secondary" disabled={p.busy} onClick={p.onComplete}>
            <CheckIcon /> {t('complete')}
          </Button>
          <Menu
            label={t('assign')}
            disabled={p.busy}
            triggerClassName="h-8 px-3"
            trigger={
              <>
                <UsersIcon /> {t('assign')}
              </>
            }
          >
            <MenuLabel>{t('assignTo')}</MenuLabel>
            {p.members.map((m) => (
              <MenuItem key={m.id} onSelect={() => p.onAssign(m.id)}>
                {m.id === p.meId ? t('me', { name: m.fullName }) : m.fullName}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onSelect={() => p.onAssign(null)}>{t('unassign')}</MenuItem>
          </Menu>
        </>
      )}
      {p.canDelete && (
        <Button
          size="sm"
          variant="secondary"
          className="border-danger text-danger hover:bg-danger/10"
          disabled={p.busy}
          onClick={p.onDelete}
        >
          <TrashIcon /> {t('delete')}
        </Button>
      )}
      <button
        type="button"
        onClick={p.onClear}
        className="ms-auto text-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t('clear')}
      </button>
    </div>
  );
}
