/** 1536 -> "1.5 KB". Whole bytes below 1 KB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }
  return `${u === 0 ? Math.round(n) : n.toFixed(n >= 10 ? 0 : 1)} ${units[u]}`;
}
