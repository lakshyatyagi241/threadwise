/**
 * What a `CryptoService` blob looks like: `v1:<iv>:<tag>:<ciphertext>` with an optional trailing 8-hex key id, or the bound form
 * `v2:<iv>:<tag>:<ciphertext>:<key id>:<32-hex context label>`. Used to FIND
 * ciphertext in the database without knowing which column holds it, so a domain that stores secrets cannot be forgotten by a
 * key rotation.
 *
 * It only says "shaped like one". A string can match without being ours (then decrypting it fails and it is reported, never
 * rewritten), and the check is deliberately strict enough that ordinary text such as `v1:beta` does not.
 */
const B64 = '[A-Za-z0-9+/]+={0,2}';
export const ENVELOPE_SOURCE = `^(?:v1:${B64}:${B64}:(?:${B64})?(?::[0-9a-f]{8})?|v2:${B64}:${B64}:(?:${B64})?:[0-9a-f]{8}:[0-9a-f]{32})$`;
export const ENVELOPE = new RegExp(ENVELOPE_SOURCE);

export const looksSealed = (value: unknown): value is string =>
  typeof value === 'string' && ENVELOPE.test(value);

/**
 * Walks any JSON value and calls `visit` on every string that looks like a sealed blob, replacing it with what `visit` returns.
 * Returns a new value; the input is not changed. Object keys are left alone.
 */
export function mapSealed(value: unknown, visit: (blob: string) => string): unknown {
  if (looksSealed(value)) return visit(value);
  if (Array.isArray(value)) return value.map((v) => mapSealed(v, visit));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, mapSealed(v, visit)]),
    );
  }
  return value;
}

/** Every sealed blob inside a JSON value. */
export function collectSealed(value: unknown): string[] {
  const found: string[] = [];
  mapSealed(value, (blob) => {
    found.push(blob);
    return blob;
  });
  return found;
}
