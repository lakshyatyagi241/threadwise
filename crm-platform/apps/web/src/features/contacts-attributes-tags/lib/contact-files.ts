const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/**
 * "2.4 MB": a size in bytes in the viewer's language (Intl's own unit names, so there is no literal to translate).
 * 1024 steps, one decimal under ten, none above. Null for an unknown size.
 */
export function formatBytes(bytes: number | null | undefined, locale: string): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const shown = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: UNITS[unit],
      unitDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(shown);
  } catch {
    return `${shown} ${UNITS[unit]}`;
  }
}

/** The file's type for the list: its MIME type, else the extension of its name in capitals ("PDF"); null when neither says. */
export function fileTypeOf(mimeType: string | null | undefined, fileName: string): string | null {
  const mime = mimeType?.trim();
  if (mime) return mime;
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return null;
  const ext = fileName.slice(dot + 1);
  return /^[A-Za-z0-9]{1,8}$/.test(ext) ? ext.toUpperCase() : null;
}
