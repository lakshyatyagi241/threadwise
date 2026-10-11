'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@crm/ui';
import { EMOJI_GROUPS, pushRecentEmoji, readRecentEmoji } from '../lib/emoji';

export interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Where the panel sits; by default above the composer's start edge. */
  className?: string;
}

/**
 * A small emoji panel over the composer. Picking one inserts it at the caret and keeps the panel open (people add several); Escape
 * or a click outside closes it. Recently used emoji come first.
 */
export function EmojiPicker({ onPick, onClose, className }: EmojiPickerProps) {
  const t = useTranslations('team-inbox-conversations.composer');
  const root = useRef<HTMLDivElement>(null);
  // Opened by a click, so this only ever runs in the browser.
  const [recent, setRecent] = useState<string[]>(() => readRecentEmoji());
  const [group, setGroup] = useState<string>(EMOJI_GROUPS[0].id);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      const target = e.target as Element;
      // The toggle button handles its own click: closing here as well would reopen the panel on the same click.
      if (target.closest?.('[data-testid="inbox-emoji-button"]')) return;
      if (root.current && !root.current.contains(target)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  const active = EMOJI_GROUPS.find((g) => g.id === group) ?? EMOJI_GROUPS[0];
  const pick = (e: string) => {
    setRecent(pushRecentEmoji(e));
    onPick(e);
  };

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={t('emojiPanel')}
      data-testid="inbox-emoji-panel"
      className={cn(
        'absolute z-20 w-72 rounded-lg border border-border bg-background p-2 shadow-lg',
        className ?? 'bottom-full start-3 mb-2',
      )}
    >
      {recent.length > 0 && (
        <div className="mb-1.5 border-b border-border pb-1.5">
          <p className="px-1 text-[11px] font-medium text-muted-foreground">{t('emojiRecent')}</p>
          <div className="flex flex-wrap">
            {recent.map((e) => (
              <EmojiButton key={`r-${e}`} emoji={e} onPick={pick} />
            ))}
          </div>
        </div>
      )}
      <div role="tablist" aria-label={t('emojiGroups')} className="mb-1 flex gap-1">
        {EMOJI_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={g.id === active.id}
            aria-label={t(`emojiGroup.${g.id}`)}
            title={t(`emojiGroup.${g.id}`)}
            onClick={() => setGroup(g.id)}
            className={cn(
              'flex size-8 items-center justify-center rounded-md text-lg focus-visible:ring-2 focus-visible:ring-primary',
              g.id === active.id ? 'bg-primary/15' : 'hover:bg-muted',
            )}
          >
            {g.icon}
          </button>
        ))}
      </div>
      <div className="flex max-h-44 flex-wrap overflow-y-auto thin-scrollbar" role="group">
        {active.emoji.map((e) => (
          <EmojiButton key={e} emoji={e} onPick={pick} />
        ))}
      </div>
    </div>
  );
}

function EmojiButton({ emoji, onPick }: { emoji: string; onPick: (e: string) => void }) {
  return (
    <button
      type="button"
      data-testid="inbox-emoji"
      aria-label={emoji}
      onClick={() => onPick(emoji)}
      className="flex size-8 items-center justify-center rounded-md text-xl hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
    >
      {emoji}
    </button>
  );
}
