/**
 * The size and type limits of each brand file, mirrored from the API (which is the authority and re-checks the bytes).
 * Checking here only saves a round trip: the person is told at once which rule the file breaks.
 */
const LIMITS: Record<string, { kb: number; exts: readonly string[] }> = {
  favicon: { kb: 512, exts: ['png', 'ico', 'jpg', 'jpeg', 'svg', 'webp'] },
  'pwa-192': { kb: 1024, exts: ['png', 'webp'] },
  'pwa-512': { kb: 2048, exts: ['png', 'webp'] },
  'ti-192': { kb: 1024, exts: ['png', 'webp'] },
  'ti-512': { kb: 2048, exts: ['png', 'webp'] },
};
const LOGO = { kb: 1024, exts: ['png', 'jpg', 'jpeg', 'svg', 'webp'] } as const;

const limitFor = (slot: string) => LIMITS[slot] ?? LOGO;
export const assetLimitKb = (slot: string) => limitFor(slot).kb;

/** A message key (`tooLarge` or `wrongType`) when the file breaks a rule, else null. */
export function validateAssetFile(
  slot: string,
  file: { name: string; size: number },
): 'tooLarge' | 'wrongType' | null {
  const lim = limitFor(slot);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!lim.exts.includes(ext)) return 'wrongType';
  if (file.size > lim.kb * 1024) return 'tooLarge';
  return null;
}
