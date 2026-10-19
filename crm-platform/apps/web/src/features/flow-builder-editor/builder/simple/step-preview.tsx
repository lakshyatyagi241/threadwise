import type { SimpleStep } from '../../lib/simple-model';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

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
      // eslint-disable-next-line @next/next/no-img-element
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
    const image = str(cards[0]?.image).trim();
    if (!image && cards.length === 0) return null;
    return (
      <div className="mt-3 flex items-center gap-2">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            className="h-14 w-20 rounded-md border border-border object-cover"
          />
        ) : null}
        <span className="text-[12px] text-muted-foreground">{cards.length} ×</span>
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
