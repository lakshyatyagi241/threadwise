'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Spinner, cn } from '@crm/ui';
import { TagPill } from './chips';
import { sameTagName, TAG_NAME_MAX } from '../api/tags';

export interface TagLite {
  /** Absent for a tag that will be created when the contact is saved (add mode). */
  id?: string;
  name: string;
  color?: string | null;
}

/**
 * The Tags block of the contact form (WD-CON-038..040): attached chips with a remove button, every workspace tag as a
 * toggle chip, and a box that attaches by name, creating the tag when it does not exist. The parent decides what
 * "attach" means: immediate API calls when editing, a pending list when adding.
 */
export function TagsEditor({
  attached,
  all,
  loading,
  busy,
  canCreate,
  onAttach,
  onDetach,
}: {
  attached: readonly TagLite[];
  all: readonly TagLite[];
  loading?: boolean;
  busy?: boolean;
  /** Typing a new name creates a tag; false hides the box (no `record.tags.create`). */
  canCreate: boolean;
  onAttach: (tag: TagLite) => void;
  onDetach: (tag: TagLite) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.tags');
  const listId = useId();
  const inputId = useId();
  const [text, setText] = useState('');

  const isAttached = (tag: TagLite) => attached.some((a) => sameTagName(a.name, tag.name));

  function addTyped() {
    const name = text.trim();
    if (!name) return;
    const existing = all.find((x) => sameTagName(x.name, name));
    if (existing && isAttached(existing)) {
      setText('');
      return;
    }
    onAttach(existing ?? { name });
    setText('');
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTyped();
    }
  }

  return (
    <div className="space-y-2">
      <div
        className="flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-md border border-border p-2"
        aria-live="polite"
      >
        {loading ? (
          <Spinner label={t('loading')} />
        ) : attached.length === 0 ? (
          <span className="px-1 text-sm text-muted-foreground">{t('none')}</span>
        ) : (
          attached.map((tag) => (
            <TagPill
              key={tag.id ?? tag.name}
              name={tag.name}
              color={tag.color}
              onRemove={() => onDetach(tag)}
              removeLabel={t('remove', { name: tag.name })}
            />
          ))
        )}
        {busy && <Spinner label={t('saving')} />}
      </div>

      {all.length > 0 && (
        <div role="group" aria-label={t('picker')} className="flex flex-wrap gap-1.5">
          {all.map((tag) => {
            const on = isAttached(tag);
            return (
              <button
                key={tag.id ?? tag.name}
                type="button"
                aria-pressed={on}
                disabled={busy}
                onClick={() => (on ? onDetach(tag) : onAttach(tag))}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs font-medium transition',
                  on
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {on && <span aria-hidden="true">&#10003; </span>}
                {tag.name}
              </button>
            );
          })}
        </div>
      )}
      {!loading && all.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {canCreate ? t('noneInWorkspace') : t('noneAvailable')}
        </p>
      )}

      {canCreate && (
        <div className="flex gap-2">
          <Input
            id={inputId}
            list={listId}
            value={text}
            maxLength={TAG_NAME_MAX}
            autoComplete="off"
            placeholder={t('addPlaceholder')}
            aria-label={t('addLabel')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
          />
          <datalist id={listId}>
            {all.map((tag) => (
              <option key={tag.id ?? tag.name} value={tag.name} />
            ))}
          </datalist>
          <Button
            variant="secondary"
            className="shrink-0 whitespace-nowrap"
            disabled={busy || !text.trim()}
            onClick={addTyped}
          >
            {t('add')}
          </Button>
        </div>
      )}
    </div>
  );
}
