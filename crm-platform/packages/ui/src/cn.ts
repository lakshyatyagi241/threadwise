import { twMerge } from 'tailwind-merge';

/** Joins class names and lets the last conflicting Tailwind utility win (`p-5` then `p-0` is `p-0`). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return twMerge(parts.filter(Boolean).join(' '));
}
