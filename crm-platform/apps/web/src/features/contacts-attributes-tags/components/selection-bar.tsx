'use client';

import { useTranslations } from 'next-intl';
import { Button, Menu, MenuItem } from '@crm/ui';
import { BulkPickers, type BulkPicker, type TagChoice } from './bulk-bar';
import {
  ChevronDownIcon,
  DownloadIcon,
  SendIcon,
  TagIcon,
  TrashIcon,
  UserIcon,
  FlagIcon,
} from './icons';

export interface SelectionBarProps {
  /** Selected rows, or `null` when the selection stands for everything matching the filter. */
  count: number | null;
  busy: boolean;
  can: { update: boolean; delete: boolean; export: boolean; createTags: boolean };
  onClear: () => void;
  onSendCampaign: () => void;
  onExport: () => void;
  onDelete: () => void;
  /** Opens the Update dialog on the owner field. */
  onAssignOwner: () => void;
  /** Opens the Update dialog on the stage field. */
  onChangeStage: () => void;
  /** Opens the Update dialog (stage, status, owner and custom properties together). */
  onUpdate: () => void;
  picker: BulkPicker;
  onPicker: (p: BulkPicker) => void;
  onGroup: (action: 'add' | 'remove', groupId: string) => Promise<boolean>;
  onTagApply: (action: 'add' | 'remove', choices: TagChoice[]) => Promise<boolean>;
}

const action = 'h-8 gap-1.5 whitespace-nowrap px-2.5 text-[13px]';

/**
 * The bar that replaces the saved-view row while rows are ticked: how many, Clear, and the actions that work on them (Send campaign,
 * Tag, Assign owner, Change stage, Export, Delete, and "More" for Update, the group actions and Untag). Each action is shown only when
 * the person's permissions allow it; the server checks them again.
 */
export function SelectionBar(p: SelectionBarProps) {
  const t = useTranslations('contacts-attributes-tags.bulk');
  const off = p.busy;
  return (
    <div
      role="region"
      aria-label={t('label')}
      className="relative flex min-h-[3.25rem] flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2"
    >
      <span className="text-sm font-semibold" aria-live="polite">
        {p.count === null ? t('allMatching') : t('selected', { count: p.count })}
      </span>
      <button
        type="button"
        onClick={p.onClear}
        className="rounded px-1 text-sm text-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t('clear')}
      </button>
      <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-border sm:block" />
      <Button variant="secondary" className={action} disabled={off} onClick={p.onSendCampaign}>
        <SendIcon className="size-4" />
        {t('sendCampaign')}
      </Button>
      {p.can.update && (
        <>
          <Button
            variant="secondary"
            className={action}
            disabled={off}
            onClick={() => p.onPicker('tagAdd')}
          >
            <TagIcon className="size-4" />
            {t('tag')}
          </Button>
          <Button variant="secondary" className={action} disabled={off} onClick={p.onAssignOwner}>
            <UserIcon className="size-4" />
            {t('assignOwner')}
          </Button>
          <Button variant="secondary" className={action} disabled={off} onClick={p.onChangeStage}>
            <FlagIcon className="size-4" />
            {t('changeStage')}
          </Button>
        </>
      )}
      {p.can.export && (
        <Button variant="secondary" className={action} disabled={off} onClick={p.onExport}>
          <DownloadIcon className="size-4" />
          {t('export')}
        </Button>
      )}
      {p.can.update && (
        <Menu
          label={t('more')}
          triggerClassName={action}
          trigger={
            <>
              {t('more')}
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            </>
          }
        >
          <MenuItem onSelect={p.onUpdate} disabled={off}>
            {t('update')}
          </MenuItem>
          <MenuItem onSelect={() => p.onPicker('groupAdd')} disabled={off}>
            {t('addToGroup')}
          </MenuItem>
          <MenuItem onSelect={() => p.onPicker('groupRemove')} disabled={off}>
            {t('removeFromGroup')}
          </MenuItem>
          <MenuItem onSelect={() => p.onPicker('tagRemove')} disabled={off}>
            {t('untag')}
          </MenuItem>
        </Menu>
      )}
      {p.can.delete && (
        <>
          <span className="ms-auto" />
          <Button
            variant="secondary"
            className={`${action} border-danger text-danger hover:bg-danger/10`}
            disabled={off}
            onClick={p.onDelete}
          >
            <TrashIcon className="size-4" />
            {t('delete')}
          </Button>
        </>
      )}
      <BulkPickers
        picker={p.picker}
        canCreateTags={p.can.createTags}
        onClose={() => p.onPicker(null)}
        onGroup={p.onGroup}
        onTag={p.onTagApply}
      />
    </div>
  );
}
