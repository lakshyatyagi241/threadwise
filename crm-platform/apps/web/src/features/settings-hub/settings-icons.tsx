import type { ReactNode, SVGProps } from 'react';
import { NavIcon, hasNavIcon } from '@/components/shell/nav-icons';

/**
 * Icons the Settings tiles need on top of the menu's set (`components/shell/nav-icons.tsx`): plain inline SVG outlines on the
 * same 16px grid. A tile names its icon in `SettingsTile.icon`; the name is looked up here first, then in the menu's icons, and
 * an unknown name falls back to a dot so a typo never leaves a hole in the grid.
 */
const PATHS: Record<string, ReactNode> = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3.5 3.5" />
    </>
  ),
  whatsapp: (
    <>
      <path d="M2.5 13.5 3.6 10A5.8 5.8 0 1 1 6 12.4z" />
      <path d="M6.2 6.1c0 2 1.7 3.7 3.7 3.7l.9-1-1.3-.8-.6.5a3 3 0 0 1-1.5-1.5l.5-.6-.8-1.3z" />
    </>
  ),
  facebook: (
    <>
      <path d="M8 2a6 6 0 0 0-6 6c0 1.8.8 3.3 2 4.4V14l1.9-1A6 6 0 1 0 8 2z" />
      <path d="m5 9.6 2.2-2.4 1.3 1.2L11 6.6" />
    </>
  ),
  instagram: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="3.2" />
      <circle cx="8" cy="8" r="2.6" />
      <circle cx="11.2" cy="4.8" r=".6" />
    </>
  ),
  tiktok: <path d="M9.6 2v7.6a2.6 2.6 0 1 1-2.6-2.6M9.6 2c.3 1.7 1.5 2.8 3.2 2.9" />,
  tag: (
    <>
      <path d="M2.5 8.2V3.5a1 1 0 0 1 1-1h4.7l5.3 5.3a1 1 0 0 1 0 1.4l-4.3 4.3a1 1 0 0 1-1.4 0z" />
      <circle cx="5.6" cy="5.6" r="1" />
    </>
  ),
  shield: (
    <>
      <path d="M8 2 13 3.8v4c0 3-2.1 5-5 6.2-2.9-1.2-5-3.2-5-6.2v-4z" />
      <path d="m5.8 8 1.6 1.6 3-3" />
    </>
  ),
  transfer: <path d="M3 5.5h9M9.5 3 12 5.5 9.5 8M13 10.5H4M6.5 8 4 10.5 6.5 13" />,
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </>
  ),
  building: (
    <>
      <path d="M3 13.5v-10a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v10M10 7h2.5a.5.5 0 0 1 .5.5v6M2 13.5h12" />
      <path d="M5.5 5h2M5.5 7.5h2M5.5 10h2" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.6" />
      <path d="M3 13.5c.4-2.6 2.5-4 5-4s4.6 1.4 5 4" />
    </>
  ),
  brush: (
    <path d="M13.2 2.8 7.6 8.4M6.2 9.4C4.7 9.4 3.8 10.5 3.8 11.7c0 1-.6 1.5-1 1.9 2.8.4 5.4-.4 5.4-2.7M7.2 8l1.8 1.8" />
  ),
  plan: <path d="M8 2 14 5 8 8 2 5zM2 8l6 3 6-3M2 11l6 3 6-3" />,
  key: (
    <>
      <circle cx="5.5" cy="10.5" r="2.7" />
      <path d="M7.5 8.5 13 3M11 5l1.5 1.5M9.5 6.5 11 8" />
    </>
  ),
  wallet: (
    <>
      <path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h8v2.5M2.5 4.5V12A1.5 1.5 0 0 0 4 13.5h9a.5.5 0 0 0 .5-.5V6a.5.5 0 0 0-.5-.5H4a1.5 1.5 0 0 1-1.5-1z" />
      <circle cx="10.6" cy="9.5" r=".8" />
    </>
  ),
  'message-billing': (
    <>
      <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2h7A2.5 2.5 0 0 1 14 4.5v4a2.5 2.5 0 0 1-2.5 2.5H6l-3 2v-2A2.5 2.5 0 0 1 2 8.5z" />
      <path d="M8 3.8v5.4M9.6 5.1c-.4-.5-1-.7-1.6-.7-.9 0-1.5.5-1.5 1.1 0 1.5 3.1.7 3.1 2.2 0 .6-.7 1.1-1.6 1.1-.6 0-1.2-.2-1.6-.7" />
    </>
  ),
  puzzle: (
    <path d="M6 3.5a1.5 1.5 0 0 1 3 0V5h3.5v3h-1.2a1.4 1.4 0 1 0 0 2.8h1.2v3H9v-1.3a1.4 1.4 0 1 0-2.8 0V14H2.5v-3.5h1.3a1.4 1.4 0 1 0 0-2.8H2.5V5H6z" />
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2 2 2.5 4 2.5 6S10 12 8 14M8 2C6 4 5.5 6 5.5 8S6 12 8 14" />
    </>
  ),
  sliders: (
    <>
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 8h2M7.5 8h6M2.5 11.5h7M12.5 11.5h1" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="8" r="1.5" />
      <circle cx="11" cy="11.5" r="1.5" />
    </>
  ),
};

export function hasSettingsIcon(name: string | undefined): boolean {
  return Boolean(name && (name in PATHS || hasNavIcon(name)));
}

export function SettingsIcon({
  name,
  className = 'size-5',
  ...rest
}: { name?: string } & SVGProps<SVGSVGElement>) {
  if (!name || !(name in PATHS)) return <NavIcon name={name} className={className} {...rest} />;
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
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
