'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@crm/ui';

export type PreviewDevice = 'desktop' | 'mobile';
// 1024 is where the guest designs switch to their wide layout, so a frame that wide shows it.
const WIDTHS: Record<PreviewDevice, number> = { desktop: 1024, mobile: 390 };
const HEIGHTS: Record<PreviewDevice, number> = { desktop: 760, mobile: 760 };

/** Copies the app's stylesheets into the frame so Tailwind's media queries answer to the frame's width. */
function mirrorDocument(frame: Document) {
  const parent = document;
  frame.head.querySelectorAll('[data-mirrored]').forEach((n) => n.remove());
  parent.head.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    const clone = node.cloneNode(true) as HTMLElement;
    clone.setAttribute('data-mirrored', '');
    frame.head.appendChild(clone);
  });
  const root = frame.documentElement;
  root.lang = parent.documentElement.lang;
  root.dir = parent.documentElement.dir;
  root.dataset.theme = parent.documentElement.dataset.theme ?? 'light';
  frame.body.className = parent.body.className;
  frame.body.style.margin = '0';
}

/**
 * Renders its children inside a same-origin iframe, scaled to fit. Because the page inside is a real
 * document of its own width, the guest design's responsive layout (marketing panel, centred card)
 * behaves exactly as it does for a visitor on that device.
 */
export function PreviewFrame({
  device,
  title,
  children,
  widths,
  height: frameHeight,
}: {
  device: PreviewDevice;
  title: string;
  children: ReactNode;
  /** A page that wants other widths than the guest pages' (the booking page previews at the 375px phone). */
  widths?: Partial<Record<PreviewDevice, number>>;
  height?: number;
}) {
  const t = useTranslations('auth-registration-security.platform.authPages.preview');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);

  const setup = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || !doc.body) return;
    mirrorDocument(doc);
    let host = doc.getElementById('preview-root');
    if (!host) {
      host = doc.createElement('div');
      host.id = 'preview-root';
      host.style.minHeight = '100vh';
      doc.body.appendChild(host);
    }
    setMount(host);
  }, []);

  useEffect(() => {
    setup();
  }, [setup]);

  // Follow theme and direction changes made in the console while the preview is open.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const doc = frameRef.current?.contentDocument;
      if (!doc) return;
      doc.documentElement.dataset.theme = document.documentElement.dataset.theme ?? 'light';
      doc.documentElement.dir = document.documentElement.dir;
      doc.documentElement.lang = document.documentElement.lang;
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'dir', 'lang'],
    });
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBoxWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = widths?.[device] ?? WIDTHS[device];
  const height = frameHeight ?? HEIGHTS[device];
  const scale = boxWidth > 0 ? Math.min(1, boxWidth / width) : 1;

  return (
    // The wrapper is left-to-right so the scale origin is always the top-left corner, whatever the page direction.
    <div
      ref={boxRef}
      dir="ltr"
      className="w-full overflow-hidden rounded-md border border-border bg-muted"
      style={{ height: height * scale }}
    >
      <div
        className={cn('origin-top-left', device === 'mobile' && scale >= 1 && 'mx-auto')}
        style={{ width, height, transform: `scale(${scale})` }}
      >
        <iframe
          ref={frameRef}
          title={title}
          aria-label={t('frameLabel')}
          onLoad={setup}
          className="block size-full border-0 bg-background"
          // Same-origin, script-free document of our own making: nothing inside can navigate the console.
          sandbox="allow-same-origin"
        />
      </div>
      {mount && createPortal(children, mount)}
    </div>
  );
}
