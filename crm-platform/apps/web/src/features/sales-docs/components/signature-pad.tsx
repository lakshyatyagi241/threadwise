'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@crm/ui';

/**
 * A signature box: draw with a finger, a pen or the mouse. The result is a PNG data URL (null while the box is empty), always
 * black ink on white whatever the theme, so the saved signature reads the same everywhere. A box cannot be operated from a
 * keyboard, so the form offers "sign with my typed name" next to it; this component only draws.
 */
export function SignaturePad({
  onChange,
  disabled,
  className,
  describedBy,
}: {
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  className?: string;
  describedBy?: string;
}) {
  const t = useTranslations('sales-docs.signature');
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // Size the bitmap to the box and the screen's pixel density so lines stay sharp.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      el.width = Math.max(1, Math.round(r.width * dpr));
      el.height = Math.max(1, Math.round(r.height * dpr));
      const ctx = el.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#0f172a';
      }
      setEmpty(true);
      onChange(null);
    };
    fit();
    const ro = new ResizeObserver(() => {
      // a resize clears the bitmap; only react to a real change of width (not the scrollbar flicker)
      if (
        Math.abs(el.getBoundingClientRect().width * (window.devicePixelRatio || 1) - el.width) > 2
      )
        fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    last.current = p;
    const ctx = canvas.current!.getContext('2d')!;
    // a tap leaves a dot
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01);
    ctx.stroke();
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const p = point(e);
    const ctx = canvas.current!.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    setEmpty(false);
    onChange(canvas.current!.toDataURL('image/png'));
  }
  function clear() {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.restore();
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative rounded-md border border-dashed border-[#94a3b8] bg-white">
        <canvas
          ref={canvas}
          role="img"
          aria-label={t('area')}
          aria-describedby={describedBy}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className={cn(
            'block h-32 w-full touch-none rounded-md',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-crosshair',
          )}
        />
        {empty && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[#94a3b8]"
          >
            {t('placeholder')}
          </span>
        )}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-4 bottom-8 border-b border-[#cbd5e1]"
        />
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={clear} disabled={disabled || empty}>
          {t('clear')}
        </Button>
      </div>
    </div>
  );
}
