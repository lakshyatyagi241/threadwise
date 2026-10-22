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
    if (cards.length === 0) return null;
    // Every card, side by side (up to ten): its picture, its title and its buttons, so nothing has to be opened to see them.
    return (
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1" data-testid="carousel-cards">
        {cards.map((c, i) => {
          const image = str(c.image).trim();
          const buttons = arr(c.buttons)
            .map((b) => str(rec(b).label).trim())
            .filter(Boolean);
          return (
            <div
              key={i}
              data-testid="carousel-card"
              className="w-28 shrink-0 overflow-hidden rounded-lg border border-border bg-background"
            >
              {image ? (
                <img src={image} alt="" className="h-16 w-full object-cover" />
              ) : (
                <div className="h-16 w-full bg-muted" aria-hidden="true" />
              )}
              <div className="space-y-1 p-1.5">
                <div className="line-clamp-2 text-[11.5px] font-semibold leading-tight">
                  {str(c.title).trim() || `#${i + 1}`}
                </div>
                {buttons.map((label, j) => (
                  <div
                    key={j}
                    className="truncate rounded border border-border px-1 py-0.5 text-center text-[10.5px] text-brand"
                  >
                    {label}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
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
