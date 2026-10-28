'use client';

import { useEffect, useRef } from 'react';
import { cn } from '../cn';
import { startGetaLoaderAnimation } from './geta-loader-canvas';

export interface GetaLoaderProps {
  /** Path or address of the brand logo shown at the centre. Left out, only the arcs show. */
  logoSrc?: string;
  /** Pixel size of the whole loader (a square). Default 140. */
  size?: number;
  /** Pixel size of the logo. Default a third of `size`. */
  logoSize?: number;
  /** Fills the viewport and centres the loader, for a whole-page loading state. Default false. */
  fullScreen?: boolean;
  /** Accessible name of the loader; the default is "Loading". */
  label?: string;
  className?: string;
}

/**
 * Geta's branded loader: three glowing arcs turning around the logo, drawn on a canvas (see `geta-loader-canvas.ts`). Pass the
 * logo; buttons and other small spots keep the small `Spinner`.
 */
export function GetaLoader({
  logoSrc,
  size = 140,
  logoSize,
  fullScreen = false,
  label = 'Loading',
  className,
}: GetaLoaderProps) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    return el ? startGetaLoaderAnimation(el, size) : undefined;
  }, [size]);

  const logo = logoSize ?? Math.round(size / 3);
  const loader = (
    <div
      className={cn('relative flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="status"
      aria-label={label}
    >
      <canvas
        ref={canvas}
        width={size}
        height={size}
        className="absolute inset-0"
        aria-hidden="true"
      />
      {logoSrc && (
        <img src={logoSrc} alt="" width={logo} height={logo} className="relative object-contain" />
      )}
    </div>
  );

  if (!fullScreen) return loader;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">{loader}</div>
  );
}
