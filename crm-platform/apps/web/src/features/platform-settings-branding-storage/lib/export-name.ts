/** `<brand-slug>-settings-YYYYMMDD-HHMM.json`, the name WaDesk gives its export (WD-SET-004). */
export function exportFileName(appName: string, at: Date): string {
  const slug =
    appName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'platform';
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-${p(at.getUTCHours())}${p(at.getUTCMinutes())}`;
  return `${slug}-settings-${stamp}.json`;
}
