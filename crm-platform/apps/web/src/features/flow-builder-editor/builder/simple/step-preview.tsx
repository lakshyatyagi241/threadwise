'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SimpleStep } from '../../lib/simple-model';
import { marksToHtml, RICH_TEXT_CLASS } from '../../lib/rich-text';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * A message-like step's text on its collapsed card: the marks drawn as bold, italic and so on, and every line break kept, as the box
 * shows them. With no text, the one-line `fallback`.
 */
export function StepText({ text, fallback }: { text: string; fallback: string }) {
  if (!text.trim())
    return (
      <p className="line-clamp-4 whitespace-pre-wrap break-words text-[13px] text-muted-foreground">
        {fallback}
      </p>
    );
  return (
    <p
      className={`line-clamp-4 break-words text-[13px] text-muted-foreground ${RICH_TEXT_CLASS}`}
      dangerouslySetInnerHTML={{ __html: marksToHtml(text.trimEnd()) }}
    />
  );
}

/**
 * What a Media, Carousel or Link step sends, drawn under its collapsed card: the picture / video / audio, the first card's picture
 * and title, and each button with the link it opens, so nobody has to open the step to check what was saved.
 */
export function StepPreview({ step }: { step: SimpleStep }) {
  const d = step.data;
  if (step.type === 'media') {
    const url = str(d.url).trim();
    if (!url) return null;
    const kind = str(d.kind) || 'image';
    if (kind === 'image')
      return (
        <img
          src={url}
          alt=""
          className="mt-3 max-h-36 rounded-md border border-border object-cover"
        />
      );
    if (kind === 'video')
      return (
        <video
          src={url}
          controls
          preload="metadata"
          onClick={(e) => e.stopPropagation()}
          className="mt-3 max-h-36 rounded-md border border-border bg-black"
        />
      );
    if (kind === 'audio')
      return (
        <audio
          src={url}
          controls
          preload="metadata"
          onClick={(e) => e.stopPropagation()}
          className="mt-3 h-9 w-full max-w-xs"
        />
      );
    return null;
  }
  if (step.type === 'carousel') {
    const cards = arr(d.cards).map(rec);
    return cards.length === 0 ? null : <CarouselPager cards={cards} />;
  }
  if (step.type === 'cta') {
    const actions = arr(d.actions)
      .map(rec)
      .filter((a) => str(a.label).trim() || str(a.value).trim());
    if (actions.length === 0) return null;
    return (
      <div className="mt-3 space-y-1.5">
        {actions.map((a, i) => (
          <div key={i} className="rounded-lg border border-border bg-muted/40 px-3 py-1.5">
            <div className="truncate text-[12.5px] font-semibold text-brand">{str(a.label)}</div>
            {str(a.value).trim() ? (
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                {str(a.value)}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );
  }
  return null;
}

/**
 * A closed Carousel step: one card at a time as the customer sees it (picture, title, text, buttons), with arrows to walk through
 * all of them and a dot for each card.
 */
function CarouselPager({ cards }: { cards: Array<Record<string, unknown>> }) {
  const t = useTranslations('flb.builder.simple.editors');
  const [at, setAt] = useState(0);
  const here = Math.min(at, cards.length - 1);
  const c = cards[here]!;
  const image = str(c.image).trim();
  const buttons = arr(c.buttons)
    .map((b) => str(rec(b).label).trim())
    .filter(Boolean);
  const arrow =
    'absolute top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg border border-border bg-background text-base leading-none text-foreground/70 shadow-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';
  return (
    <div className="relative mt-3" data-testid="carousel-pager">
      <div
        data-testid="carousel-card"
        className="overflow-hidden rounded-lg border border-border bg-background"
      >
        {image ? (
          <img src={image} alt="" className="h-40 w-full object-cover" />
        ) : (
          <div className="h-24 w-full bg-muted" aria-hidden="true" />
        )}
        <div className="space-y-2 p-3">
          {str(c.title).trim() ? (
            <div className="text-[14px] font-semibold">{str(c.title)}</div>
          ) : null}
          {str(c.text).trim() ? (
            <div className="line-clamp-3 text-[12.5px] text-muted-foreground">{str(c.text)}</div>
          ) : null}
          {buttons.map((label, j) => (
            <div
              key={j}
              className="truncate rounded-full border border-brand/60 px-3 py-1.5 text-center text-[12.5px] font-semibold text-brand"
            >
              {label}
            </div>
          ))}
        </div>
      </div>
      {here > 0 ? (
        <button
          type="button"
          aria-label={t('carousel.prev')}
          onClick={() => setAt(here - 1)}
          className={`${arrow} start-1.5`}
        >
          ‹
        </button>
      ) : null}
      {here < cards.length - 1 ? (
        <button
          type="button"
          aria-label={t('carousel.next')}
          onClick={() => setAt(here + 1)}
          className={`${arrow} end-1.5`}
        >
          ›
        </button>
      ) : null}
      {cards.length > 1 ? (
        <div className="mt-2 flex justify-center gap-1.5">
          {cards.map((_, j) => (
            <button
              key={j}
              type="button"
              aria-label={t('carousel.goTo', { n: j + 1 })}
              aria-current={j === here ? 'true' : undefined}
              onClick={() => setAt(j)}
              className={`size-2.5 rounded-sm border border-brand outline-none focus-visible:ring-2 focus-visible:ring-primary ${j === here ? 'bg-brand' : 'bg-background'}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
