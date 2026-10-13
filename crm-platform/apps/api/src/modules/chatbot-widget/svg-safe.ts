/**
 * An uploaded SVG is a picture the widget draws with `<img>` or as a CSS background, where a browser never runs its script. It is
 * still refused when it carries anything that could run or fetch (script, event handlers, foreign content, external references,
 * entity tricks), because the same file is also served at its own address and a person can open it there. What passes is a plain
 * vector picture: shapes, paths, gradients, text, styles and embedded raster images.
 */
const MAX_BYTES = 1_048_576;

const FORBIDDEN: readonly RegExp[] = [
  /<\s*script/i,
  /<\s*foreignObject/i,
  /<\s*(iframe|object|embed|audio|video|handler|listener|canvas)\b/i,
  /<!\s*(ENTITY|DOCTYPE)/i,
  /\bon[a-z]+\s*=/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /data\s*:\s*(text|application)\//i,
  /@import/i,
  /<\s*(set|animate|animateTransform|animateMotion)\b[^>]*\b(href|xlink:href)\b/i,
];

/** Every `href` / `xlink:href` / `url()` must point inside the file (`#id`) or at an embedded raster picture. */
const REFERENCE = /(?:xlink:)?href\s*=\s*("([^"]*)"|'([^']*)')|url\(\s*(['"]?)([^)'"]*)\4\s*\)/gi;
const INTERNAL_OK = /^(#|data:image\/(png|jpe?g|gif|webp);base64,)/i;

export function isSafeSvg(buffer: Buffer): boolean {
  if (buffer.length === 0 || buffer.length > MAX_BYTES) return false;
  const text = buffer.toString('utf8');
  if (text.includes('\u0000')) return false;
  const head = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/^\s*(<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*)*/, '');
  if (!/^<svg[\s>]/i.test(head)) return false;
  if (FORBIDDEN.some((re) => re.test(text))) return false;
  for (const m of text.matchAll(REFERENCE)) {
    const target = (m[2] ?? m[3] ?? m[5] ?? '').trim();
    if (target !== '' && !INTERNAL_OK.test(target)) return false;
  }
  return true;
}
