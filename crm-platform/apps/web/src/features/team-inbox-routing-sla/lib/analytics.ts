/** "Nm" under an hour, "Nh Nm" from an hour up, a dash when there is nothing to average (the way Reference wrote it). */
export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—';
  const total = Math.round(min);
  if (total < 60) return `${total}m`;
  return `${Math.floor(total / 60)}h ${total % 60}m`;
}
