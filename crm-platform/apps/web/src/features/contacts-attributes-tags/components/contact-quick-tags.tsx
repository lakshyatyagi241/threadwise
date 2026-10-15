'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  attachTagToContact,
  detachTag,
  invalidateTags,
  sameTagName,
  TAG_NAME_MAX,
  useContactTags,
  useTags,
} from '../api/tags';
import { invalidateContacts, KEYS } from '../api/contacts';
import { TagPill } from './chips';

interface Tag {
  id: string;
  name: string;
  color?: string | null;
}

/**
 * The tags on the stage row under the contact's name (they flow into that row): the attached ones with a remove button and "Add tag", which opens a small panel to pick
 * several workspace tags at once (it stays open) or to type a name and press Enter to create a new tag and attach it.
 */
export function ContactQuickTags({ contactId }: { contactId: string }) {
  const t = useTranslations('contacts-attributes-tags.tags');
  const qc = useQueryClient();
  const { toast } = useToast();
  const canUpdate = useCan('record.contacts.update');
  const canCreate = useCan('record.tags.create');
  const attached = useContactTags(contactId);
  const [open, setOpen] = useState(false);
  const all = useTags(open);
  const [text, setText] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown);
      setText('');
    };
  }, [open]);

  const change = useMutation({
    mutationFn: async (op: { kind: 'attach' | 'detach'; tag: { id?: string; name: string } }) => {
      if (op.kind === 'detach') {
        if (op.tag.id) await detachTag(contactId, op.tag.id);
        return;
      }
      await attachTagToContact(contactId, op.tag);
    },
    onSuccess: async () => {
      setText('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEYS.contactTags(contactId) }),
        invalidateTags(qc),
        invalidateContacts(qc),
      ]);
    },
    onError: () => toast(t('failed'), 'danger'),
  });

  const mine: Tag[] = attached.data ?? [];
  const isOn = (name: string) => mine.some((m) => sameTagName(m.name, name));
  const workspace = useMemo<Tag[]>(() => all.data ?? [], [all.data]);
  const needle = text.trim().toLowerCase();
  const shown = useMemo(
    () => workspace.filter((w) => !needle || w.name.toLowerCase().includes(needle)),
    [workspace, needle],
  );
  const exact = workspace.find((w) => sameTagName(w.name, text));
  const canMake = canCreate && needle !== '' && !exact && !isOn(text);

  const toggle = (tag: Tag) =>
    change.mutate({
      kind: isOn(tag.name) ? 'detach' : 'attach',
      tag: isOn(tag.name) ? (mine.find((m) => sameTagName(m.name, tag.name)) ?? tag) : tag,
    });

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    // Confirming an IME composition also sends Enter; that must not create a tag.
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const name = text.trim();
    if (!name || change.isPending) return;
    // An exact name, or the one tag left in the filter, is attached; anything else creates a new tag.
    const target = exact ?? (shown.length === 1 ? shown[0] : undefined);
    if (target) {
      if (!isOn(target.name)) change.mutate({ kind: 'attach', tag: target });
    } else if (canCreate) {
      change.mutate({ kind: 'attach', tag: { name } });
    }
  }

  return (
    <div className="contents" data-testid="contact-quick-tags">
      {mine.map((tag) => (
        <TagPill
          key={tag.id}
          name={tag.name}
          color={tag.color}
          onRemove={canUpdate ? () => change.mutate({ kind: 'detach', tag }) : undefined}
          removeLabel={t('remove', { name: tag.name })}
        />
      ))}
      {canUpdate && (
        <div ref={boxRef} className="relative">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            title={t('add')}
            aria-label={t('add')}
            className="inline-flex size-8 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            {change.isPending ? (
              <Spinner label={t('saving')} />
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="size-[18px]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
                <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" />
              </svg>
            )}
          </button>
          {open && (
            <div className="absolute start-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-border bg-background p-2 shadow-lg">
              <input
                ref={inputRef}
                value={text}
                maxLength={TAG_NAME_MAX}
                autoComplete="off"
                placeholder={t('quickPlaceholder')}
                aria-label={t('addLabel')}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <ul className="mt-1.5 max-h-56 overflow-y-auto">
                {canMake && (
                  <li>
                    <button
                      type="button"
                      onClick={() =>
                        !change.isPending &&
                        change.mutate({ kind: 'attach', tag: { name: text.trim() } })
                      }
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm font-medium text-brand hover:bg-muted"
                    >
                      <span aria-hidden="true">+</span>
                      <span className="truncate">{t('create', { name: text.trim() })}</span>
                    </button>
                  </li>
                )}
                {all.isPending && (
                  <li className="px-2 py-2">
                    <Spinner label={t('loading')} />
                  </li>
                )}
                {shown.map((tag) => {
                  const on = isOn(tag.name);
                  return (
                    <li key={tag.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => !change.isPending && toggle(tag)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted"
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'grid size-4 shrink-0 place-items-center rounded border text-[10px]',
                            on
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border',
                          )}
                        >
                          {on && '✓'}
                        </span>
                        <span className="truncate">{tag.name}</span>
                      </button>
                    </li>
                  );
                })}
                {!all.isPending && shown.length === 0 && !canMake && (
                  <li className="px-2 py-2 text-xs text-muted-foreground">
                    {workspace.length === 0 && !canCreate ? t('noneAvailable') : t('noMatch')}
                  </li>
                )}
              </ul>
              <p className="mt-1.5 border-t border-border px-1 pt-1.5 text-[11px] text-muted-foreground">
                {canCreate ? t('quickHint') : t('quickHintPick')}
              </p>
            </div>
          )}
        </div>
      )}
      {!canUpdate && attached.isSuccess && mine.length === 0 && (
        <span className="text-xs text-muted-foreground">{t('none')}</span>
      )}
    </div>
  );
}
