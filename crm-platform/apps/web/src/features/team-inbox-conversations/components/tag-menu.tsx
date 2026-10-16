'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, Input, Popover, Spinner } from '@crm/ui';
import type { ConversationTag } from '@crm/contracts';
import { TagIcon } from './icons';
import { useTags } from '../api/hooks';
import { TagChip } from './tag-chip';

export interface TagMenuProps {
  applied: ConversationTag[];
  busy: boolean;
  /** May create a tag by typing a new name (`inbox.tag.manage`). */
  canCreate: boolean;
  onApply: (input: { tagId: string } | { name: string }) => void;
  onWithdraw: (tagId: string) => void;
}

/**
 * The conversation-tag picker (thread header and side panel): every workspace tag with a check mark for the ones on this thread
 * (click toggles), and, for someone who manages tags, a box to add a new one by name. The ones on the thread show as chips next to
 * the title (the header renders those); this is only the menu. These are conversation tags: they describe the thread, not the person.
 */
export function TagMenu(props: TagMenuProps) {
  const t = useTranslations('team-inbox-conversations.tags');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const library = useTags(open);
  const on = new Set(props.applied.map((l) => l.id));
  const name = draft.trim();

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        data-testid="inbox-tag-menu"
        aria-expanded={open}
        title={t('tag')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
      >
        {props.busy ? <Spinner /> : <TagIcon className="size-4" />}
        <span className="sr-only">{t('tag')}</span>
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} label={t('groups.conversationTitle')}>
        <div className="space-y-2" data-testid="inbox-tag-menu-body">
          {library.isPending && (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner /> {t('loading')}
            </p>
          )}
          {library.isError && (
            <p role="alert" className="text-xs text-danger">
              {t('loadFailed')}
            </p>
          )}
          {library.data && library.data.data.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('none')}</p>
          )}
          <ul className="max-h-56 space-y-0.5 overflow-y-auto thin-scrollbar">
            {library.data?.data.map((l) => (
              <li key={l.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={on.has(l.id)}
                    disabled={props.busy}
                    onChange={() =>
                      on.has(l.id) ? props.onWithdraw(l.id) : props.onApply({ tagId: l.id })
                    }
                  />
                  <TagChip tag={l} className="max-w-[12rem] text-xs" />
                </label>
              </li>
            ))}
          </ul>
          {props.canCreate && (
            <form
              className="flex gap-1.5 border-t border-border pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name) return;
                props.onApply({ name });
                setDraft('');
              }}
            >
              <Input
                aria-label={t('newTag')}
                placeholder={t('newTag')}
                value={draft}
                maxLength={64}
                onChange={(e) => setDraft(e.target.value)}
                className="h-8 text-xs"
              />
              <Button type="submit" size="sm" disabled={!name || props.busy}>
                {t('add')}
              </Button>
            </form>
          )}
        </div>
      </Popover>
    </div>
  );
}
