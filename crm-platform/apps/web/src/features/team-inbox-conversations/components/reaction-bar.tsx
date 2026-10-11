'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@crm/ui';
import { EmojiPicker } from './emoji-picker';

/** The six everyone reaches for; anything else is behind the plus. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export interface ReactionBarProps {
  /** What is on the message now (ours): tapping it again takes it back. */
  current: string | null;
  onPick: (emoji: string) => void;
  onClose: () => void;
  className?: string;
}

/** The row of quick reactions over a bubble. Escape or a click away closes it; picking one closes it and sends. */
export function ReactionBar({ current, onPick, onClose, className }: ReactionBarProps) {
  const t = useTranslations('team-inbox-conversations.bubble');
  const root = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (more) return; // the full picker has its own outside click and Escape
    const away = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest?.('[data-testid="inbox-react"]')) return;
      if (root.current && !root.current.contains(target)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [more, onClose]);

  // Picking the one already there takes it back (an empty emoji).
  const choose = (emoji: string) => onPick(emoji === current ? '' : emoji);

  return (
    <div
      ref={root}
      role="toolbar"
      aria-label={t('react.label')}
      data-testid="inbox-reaction-bar"
      className={cn(
        'absolute z-20 flex items-center gap-0.5 rounded-full border border-border bg-background px-1.5 py-1 shadow-lg',
        className,
      )}
    >
      {QUICK_REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          data-testid="inbox-reaction-option"
          aria-label={
            e === current ? t('react.remove', { emoji: e }) : t('react.add', { emoji: e })
          }
          aria-pressed={e === current}
          onClick={() => choose(e)}
          className={cn(
            'flex size-8 items-center justify-center rounded-full text-xl hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
            e === current && 'bg-primary/15',
          )}
        >
          {e}
        </button>
      ))}
      <button
        type="button"
        aria-label={t('react.more')}
        aria-haspopup="dialog"
        aria-expanded={more}
        onClick={() => setMore((v) => !v)}
        className="flex size-8 items-center justify-center rounded-full text-lg text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
      >
        +
      </button>
      {more && (
        <EmojiPicker
          onPick={(e) => choose(e)}
          onClose={onClose}
          className="bottom-full start-0 mb-2"
        />
      )}
    </div>
  );
}
