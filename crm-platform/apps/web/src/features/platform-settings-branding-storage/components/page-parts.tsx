import type { ReactNode } from 'react';
import { Card } from '@crm/ui';

/**
 * The frame every settings page shares with Reference's: a mono eyebrow, a title whose last word is set apart, a line of
 * explanation and the page actions (All settings, Reset draft, Save changes).
 */
export function SetHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  const words = title.trim().split(/\s+/);
  const accent = words.length > 1 ? words.pop() : null;
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {accent ? (
            <>
              {words.join(' ')} <em className="font-semibold not-italic text-primary">{accent}</em>
            </>
          ) : (
            title
          )}
          .
        </h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** The right-hand "Quick guide" card: a kicker, a title and a list of short notes. */
export function GuideCard({
  kicker,
  title,
  items,
}: {
  kicker: string;
  title: string;
  items: Array<{ title: string; body: ReactNode }>;
}) {
  return (
    <Card className="space-y-3">
      <header className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {kicker}
        </p>
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
      </header>
      <dl className="space-y-3 border-t border-border pt-3 text-sm">
        {items.map((it) => (
          <div key={it.title} className="space-y-0.5">
            <dt className="font-semibold">{it.title}</dt>
            <dd className="text-muted-foreground">{it.body}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** A soft call-out under the guide ("Production rule", "Tip", "Safe by default"). */
export function TipCard({ title, body }: { title: string; body: string }) {
  return (
    <aside className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </aside>
  );
}

/** Character counter that turns amber outside its target range (TW-SET-026 rule 1). */
export function Counter({ length, range }: { length: number; range: readonly [number, number] }) {
  const off = length > 0 && (length < range[0] || length > range[1]);
  return (
    <span
      className={off ? 'text-warning' : 'text-muted-foreground'}
      aria-live="polite"
      data-testid="counter"
    >
      {length} / {range[0]}-{range[1]}
    </span>
  );
}
