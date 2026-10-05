import type { ReactNode } from 'react';
import { NavIcon, hasNavIcon } from '@/components/shell/nav-icons';

/**
 * Icons for the console rail. The shared menu set (`NavIcon`) covers most sections; these are the few it has no
 * glyph for, drawn on the same 16px outline grid so the two read as one family.
 */
const OWN: Record<string, ReactNode> = {
  shield: (
    <>
      <path d="M8 1.8 13 3.6v3.9c0 3-2.1 5.4-5 6.7-2.9-1.3-5-3.7-5-6.7V3.6L8 1.8Z" />
      <path d="m5.8 8 1.6 1.6 3-3.2" />
    </>
  ),
  tag: (
    <>
      <path d="M2.5 2.5h5l6 6-5 5-6-6v-5Z" />
      <circle cx="5.4" cy="5.4" r="0.9" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2 1.8 3 3.8 3 6s-1 4.2-3 6c-2-1.8-3-3.8-3-6s1-4.2 3-6Z" />
    </>
  ),
  modules: (
    <>
      <path d="M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8L8 1.8Z" />
      <path d="M2.5 4.8 8 8l5.5-3.2M8 8v6.2" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.7" />
      <path d="M2.8 14c0-2.8 2.3-4.6 5.2-4.6s5.2 1.8 5.2 4.6" />
    </>
  ),
};

export const hasConsoleIcon = (name: string | undefined): boolean =>
  Boolean(name && (name in OWN || hasNavIcon(name)));

export function ConsoleIcon({ name, className = 'size-5' }: { name?: string; className?: string }) {
  const art = name && name in OWN ? OWN[name] : undefined;
  if (!art) return <NavIcon name={name} className={className} />;
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {art}
    </svg>
  );
}
