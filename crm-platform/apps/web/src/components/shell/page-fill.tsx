import type { ReactNode } from 'react';
import { cn } from '@crm/ui';

/**
 * The one way for a screen to be "as tall as the window": a list that scrolls its rows inside a card with a footer pinned under
 * them. Wrap the whole screen in it (it must be the outermost element of the page, with no block wrapper between it and the shell's
 * `<main>`), put toolbars and headers as normal children, and let the card that scrolls be `min-h-0` with `overflow-hidden`.
 *
 * Why not `h-[calc(100dvh-Nrem)]`: N has to guess the top bar, the trial and billing bars, the impersonation bar, a failed-refresh
 * notice and the page's own header, so it was wrong whenever one of them appeared, and the page then had two scrollbars (the window
 * and the card). With this, the marker below makes the shell exactly one window tall (see `.app-shell` in globals.css), `<main>` is
 * a column and this fills what is left, so every bar above is subtracted by the layout itself.
 *
 * It is also the containing block of everything absolutely positioned inside it and clips it. A visually hidden label inside a table
 * row (`sr-only` is `position: absolute`) otherwise belongs to `<main>`, escapes the scrolling card's clip and stretches the window
 * by the height of the whole table: a second scrollbar and a blank screen at the end.
 *
 * `minHeight` is the floor on a short window: below it, `<main>` (not the window) scrolls, so there is still exactly one scrollbar.
 */
export function PageFill({
  children,
  className,
  minHeight,
}: {
  children: ReactNode;
  className?: string;
  /** A CSS length such as `34rem`. */
  minHeight?: string;
}) {
  return (
    <div
      data-page-fill=""
      style={minHeight ? { minHeight } : undefined}
      // `-m-1 p-1` keeps a focus ring on the first and last control inside the clip.
      className={cn('relative -m-1 flex min-h-0 flex-1 flex-col overflow-clip p-1', className)}
    >
      {children}
    </div>
  );
}
