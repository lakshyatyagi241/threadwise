'use client';

import { useState, type CSSProperties, type ReactElement } from 'react';

/** Why a link cannot show as an image, before the browser even tries; null when it looks fine. */
export function imageLinkProblem(src: string): string | null {
  const s = src.trim();
  if (s === '') return 'the link is empty';
  if (!/^https?:\/\//i.test(s) && !/^(\/|data:image\/|blob:)/.test(s))
    return 'the link is not a web address (it must start with https://)';
  return null;
}

/**
 * An image of a flow card or the test chat. When it cannot load it says so on the spot and writes the reason to the browser console
 * as `[flow-builder] image ...`, so "why is the picture missing" is one look away: a 404, a blocked host (hotlink protection or
 * mixed content), a file that is not an image, or a link that is not a web address.
 */
export function FlowImage({
  src,
  where,
  className,
  style,
}: {
  src: string;
  /** What shows it, for the console line ("test chat", "media card"). */
  where: string;
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  const problem = imageLinkProblem(src);
  if (problem || failed) {
    const reason =
      problem ?? 'it did not load (the link may be wrong, private, blocked, or not an image)';
    if (problem) console.warn(`[flow-builder] image not shown in ${where}: ${problem}`, src);
    return (
      <div
        role="img"
        aria-label="Image not loaded"
        title={`${reason}\n${src}`}
        data-testid="flow-image-failed"
        className="flex min-h-14 flex-col justify-center gap-0.5 rounded border border-dashed border-red-400/70 bg-red-50 px-2 py-1.5 text-[11px] leading-snug text-red-700"
      >
        <strong>Image not loaded</strong>
        <span className="break-all opacity-80">{reason}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className={className}
      style={style}
      onError={() => {
        console.warn(`[flow-builder] image failed to load in ${where}`, src);
        setFailed(true);
      }}
    />
  );
}
