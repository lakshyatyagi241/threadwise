'use client';

import { useState } from 'react';
import { PackageIcon } from './icons';

/** A product image that falls back to a package glyph when it is missing or fails to load. */
export function ProductImage({
  src,
  alt,
  eager = false,
  emoji = false,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  eager?: boolean;
  /** Cart, wishlist and compare show Reference's package emoji instead of the glyph when there is no image. */
  emoji?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) {
    return (
      <span className={emoji ? undefined : 'sf-img-fallback'} role="img" aria-label={alt}>
        {emoji ? '📦' : <PackageIcon />}
      </span>
    );
  }
  return (
    // A plain img: merchant image URLs are arbitrary external hosts, which next/image would need an allow-list for.
    <img
      src={src}
      alt={alt}
      className={className}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(src)}
    />
  );
}
