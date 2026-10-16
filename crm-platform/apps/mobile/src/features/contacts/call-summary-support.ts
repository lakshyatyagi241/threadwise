/** A call length as `mm:ss` (minutes past 59 stay minutes: a 75-minute call is `75:00`). */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** `mm:ss` or `h:mm:ss` back to seconds; null when it is neither (so the form can say what to type). */
export function parseDuration(text: string): number | null {
  const match = /^(?:(\d{1,3}):)?(\d{1,3}):([0-5]?\d)$/.exec(text.trim());
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** A route parameter that should be a whole number of at least zero; `fallback` for anything else. */
export function wholeNumber(text: string, fallback: number): number {
  return /^\d{1,15}$/.test(text) ? Number(text) : fallback;
}
