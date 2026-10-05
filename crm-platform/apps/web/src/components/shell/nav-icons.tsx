import type { ReactNode, SVGProps } from 'react';

/**
 * Menu icons: plain inline SVG on a 16px grid, drawn as outlines (the same family Reference's menu uses). A screen names
 * its icon in `NavItem.icon`; an unknown name falls back to a dot so a typo never leaves a hole in the rail.
 */
const PATHS: Record<string, ReactNode> = {
  home: <path d="M2.5 7.2 8 2.5l5.5 4.7M4 6.5V13h3V9.5h2V13h3V6.5" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="m10.2 10.2 3.3 3.3" />
    </>
  ),
  grid: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </>
  ),
  dashboard: (
    <>
      <rect x="2" y="2" width="5" height="6" rx="1" />
      <rect x="9" y="2" width="5" height="3" rx="1" />
      <rect x="9" y="7" width="5" height="7" rx="1" />
      <rect x="2" y="10" width="5" height="4" rx="1" />
    </>
  ),
  analytics: <path d="M2 13V3M2 13h12M5 11V7M8 11V4M11 11V8" />,
  bell: (
    <path d="M8 2a4 4 0 0 0-4 4v2.5L3 11h10l-1-2.5V6a4 4 0 0 0-4-4zM6.5 13a1.7 1.7 0 0 0 3 0" />
  ),
  inbox: (
    <>
      <rect x="2" y="3" width="12" height="9" rx="1.5" />
      <path d="M2 6h12M5 9h2.5" />
    </>
  ),
  chat: (
    <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2h7A2.5 2.5 0 0 1 14 4.5v4A2.5 2.5 0 0 1 11.5 11H6l-3 2v-2A2.5 2.5 0 0 1 2 8.5v-4Z" />
  ),
  phone: (
    <path d="M3 3h2l1.4 3.4L5 8a8 8 0 0 0 3 3l1.6-1.4L13 11v2a1 1 0 0 1-1 1A11 11 0 0 1 2 4a1 1 0 0 1 1-1Z" />
  ),
  'team-chat': (
    <>
      <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2h5A2.5 2.5 0 0 1 12 4.5v3A2.5 2.5 0 0 1 9.5 10H6l-2.5 2v-2A1.5 1.5 0 0 1 2 8.5Z" />
      <path d="M12 6h1.5A1.5 1.5 0 0 1 15 7.5v3l-2 1.5" />
    </>
  ),
  team: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <path d="M2 14c0-2.5 2-4 4-4s4 1.5 4 4" />
      <circle cx="11.5" cy="5" r="2" />
      <path d="M9.5 12c.4-1.4 1.6-2 3-2 1.5 0 2.5 1 2.5 2.5" />
    </>
  ),
  contacts: (
    <>
      <circle cx="6" cy="5" r="2.2" />
      <path d="M2.5 13a3.5 3.5 0 0 1 7 0" />
      <path d="M11 4.7a2 2 0 0 1 0 3.6M13.5 13a3.4 3.4 0 0 0-2-3.1" />
    </>
  ),
  attributes: (
    <>
      <path d="M3 4h10M3 8h10M3 12h6" />
      <circle cx="13" cy="12" r="1.5" />
    </>
  ),
  groups: (
    <>
      <circle cx="5.5" cy="5.5" r="2" />
      <circle cx="10.5" cy="5.5" r="2" />
      <path d="M2 12.5a3.5 3.5 0 0 1 7 0M7 12.5a3.5 3.5 0 0 1 7 0" />
    </>
  ),
  pin: (
    <>
      <path d="M8 1.5c-2.8 0-5 2.1-5 4.9 0 3.4 5 8.1 5 8.1s5-4.7 5-8.1c0-2.8-2.2-4.9-5-4.9Z" />
      <circle cx="8" cy="6.3" r="1.7" />
    </>
  ),
  deal: <path d="M8 2.5l5.5 4.2L11.4 13H4.6L2.5 6.7 8 2.5Z" />,
  campaign: (
    <>
      <path d="M3 4.5A2.5 2.5 0 0 1 5.5 2h5A2.5 2.5 0 0 1 13 4.5v4A2.5 2.5 0 0 1 10.5 11H8l-3.5 2v-2A2.5 2.5 0 0 1 2 8.5v-4Z" />
      <path d="M5.5 6.5h5M5.5 8.5h3" />
    </>
  ),
  broadcast: (
    <>
      <path d="M2.5 6.5v3l7 3V3.5l-7 3Z" />
      <path d="M9.5 5.5a3 3 0 0 1 0 5" />
      <path d="M4.5 10v2.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 1" />
    </>
  ),
  template: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M2.5 6h11M6 13.5V6" />
    </>
  ),
  history: (
    <>
      <path d="M3 3v4h4" />
      <path d="M3.5 7a6 6 0 1 1 .3 2.4" />
      <path d="M8 5v3l2 1" />
    </>
  ),
  flow: (
    <>
      <circle cx="3.5" cy="8" r="1.8" />
      <circle cx="12.5" cy="3.5" r="1.8" />
      <circle cx="12.5" cy="12.5" r="1.8" />
      <path d="M5 7l6-3M5 9l6 3" />
    </>
  ),
  bot: (
    <>
      <rect x="3" y="4" width="10" height="8" rx="2" />
      <circle cx="6.2" cy="8" r="0.9" />
      <circle cx="9.8" cy="8" r="0.9" />
      <path d="M8 2v2" />
    </>
  ),
  reply: <path d="M6 3 2 7l4 4M2.5 7H9a4 4 0 0 1 4 4v1" />,
  calendar: (
    <>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6h12M5 1.5v2M11 1.5v2M5.5 9l1.3 1.3L10 8" />
    </>
  ),
  widget: (
    <>
      <rect x="3" y="3" width="10" height="8" rx="2" />
      <path d="M6 13l2-2h3" />
      <circle cx="6.5" cy="7" r="0.8" />
      <circle cx="9.5" cy="7" r="0.8" />
    </>
  ),
  channels: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <circle cx="3" cy="3.5" r="1.4" />
      <circle cx="13" cy="3.5" r="1.4" />
      <circle cx="3" cy="12.5" r="1.4" />
      <circle cx="13" cy="12.5" r="1.4" />
      <path d="M4.2 4.6 6.4 6.7M11.8 4.6 9.6 6.7M4.2 11.4 6.4 9.3M11.8 11.4 9.6 9.3" />
    </>
  ),
  send: <path d="M14 2 2 7l3.5 1.2M14 2l-2 10.5-4-3M14 2 6.5 9.2M6.5 9.2 6 12.5l2-2" />,
  sms: <path d="M2 4.5h12v7H8l-3 2.5V11.5H2z" />,
  mail: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="m2.5 5.5 5.5 4 5.5-4" />
    </>
  ),
  link: (
    <>
      <path d="M6.5 9.5a3 3 0 0 0 4 0l2-2a3 3 0 0 0-4-4l-1 1" />
      <path d="M9.5 6.5a3 3 0 0 0-4 0l-2 2a3 3 0 0 0 4 4l1-1" />
    </>
  ),
  crm: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6.5h12M5.5 9.5h5" />
    </>
  ),
  store: (
    <>
      <path d="M2.5 6h11l-1 7.5h-9Z" />
      <path d="M5.5 6V4.5a2.5 2.5 0 0 1 5 0V6" />
    </>
  ),
  catalog: (
    <>
      <rect x="2" y="2.5" width="5" height="5" rx="1" />
      <rect x="9" y="2.5" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="4.5" rx="1" />
      <rect x="9" y="9" width="5" height="4.5" rx="1" />
    </>
  ),
  apps: (
    <>
      <rect x="2" y="2.5" width="5" height="5" rx="1" />
      <rect x="9" y="2.5" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="4.5" rx="1" />
      <path d="M11.5 9.5v4M9.5 11.5h4" />
    </>
  ),
  plug: (
    <>
      <rect x="2" y="6" width="5" height="5" rx="1" />
      <rect x="9" y="3" width="5" height="5" rx="1" />
      <path d="M7 8.5h2v-1" />
    </>
  ),
  code: <path d="M6 3.5 2.5 8 6 12.5M10 3.5 13.5 8 10 12.5" />,
  webhook: (
    <>
      <circle cx="5" cy="5" r="2" />
      <circle cx="11" cy="6" r="2" />
      <circle cx="7" cy="12" r="2" />
      <path d="M6 6.6l-1 3.4M9.4 7l-2 3.4M6.8 5.5h3" />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.2 6.4a2 2 0 1 1 2.9 1.8c-.6.4-1.1.8-1.1 1.4M8 12h.01" />
    </>
  ),
  book: (
    <>
      <path d="M3 3.5h7a2 2 0 0 1 2 2v7H5a2 2 0 0 0-2 2z" />
      <path d="M5 6h5M5 8h5" />
    </>
  ),
  tasks: (
    <>
      <path d="M2.5 4.2 3.7 5.4 5.7 3.2M2.5 8.7l1.2 1.2 2-2.2M2.5 13.2l1.2 1.2 2-2.2" />
      <path d="M8.5 4.5h5M8.5 9h5M8.5 13.5h5" />
    </>
  ),
  companies: (
    <>
      <path d="M3 14V3.5A1 1 0 0 1 4 2.5h5a1 1 0 0 1 1 1V14M10 7h2.5a1 1 0 0 1 1 1v6M2 14h12" />
      <path d="M5.5 5h2M5.5 7.5h2M5.5 10h2" />
    </>
  ),
  pipelines: (
    <>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="6" r="1.5" />
      <path d="M4.5 5v6M11.5 7.5c0 2.5-2.5 2.5-5.5 3.3" />
    </>
  ),
  proposal: (
    <>
      <path d="M4 2h5.5L13 5.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M9 2v4h4M5.5 8.5h5M5.5 11h5" />
    </>
  ),
  estimate: (
    <>
      <rect x="3" y="3" width="10" height="11" rx="1.5" />
      <path d="M6 3V2h4v1M5.7 8.7l1.7 1.7 3-3.4" />
    </>
  ),
  invoice: (
    <>
      <path d="M3.5 14V2.5l1.6 1 1.6-1 1.6 1 1.6-1 1.6 1 1.6-1V14l-1.6-1-1.6 1-1.6-1-1.6 1-1.6-1Z" />
      <path d="M6 6h4.5M6 8.5h4.5" />
    </>
  ),
  payment: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M2 6.5h12M4.5 10h2.5" />
    </>
  ),
  // a funnel: rules that narrow contacts down to the ones that match (Segments)
  segment: <path d="M2.5 3h11L9.5 8.2V13l-3 1.5V8.2L2.5 3z" />,
  percent: (
    <>
      <path d="M12.5 3.5l-9 9" />
      <circle cx="4.8" cy="4.8" r="1.7" />
      <circle cx="11.2" cy="11.2" r="1.7" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M6.7 1.8h2.6l.4 1.7 1.2.7 1.6-.6 1.3 2.2-1.3 1.2v1.4l1.3 1.2-1.3 2.2-1.6-.6-1.2.7-.4 1.7H6.7l-.4-1.7-1.2-.7-1.6.6-1.3-2.2 1.3-1.2V7.3L2.2 6.1l1.3-2.2 1.6.6 1.2-.7z" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
    </>
  ),
};

export type NavIconName = keyof typeof PATHS;

export function hasNavIcon(name: string | undefined): boolean {
  return Boolean(name && name in PATHS);
}

export function NavIcon({
  name,
  className = 'size-5',
  ...rest
}: { name?: string } & SVGProps<SVGSVGElement>) {
  const art = name && name in PATHS ? PATHS[name] : <circle cx="8" cy="8" r="1.6" />;
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
      {art}
    </svg>
  );
}

/** Small glyphs the chrome itself uses (not menu entries). */
export function ChevronsUpDownIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d="M4.5 6 8 2.5 11.5 6M4.5 10 8 13.5 11.5 10" />
    </svg>
  );
}

export function ChevronIcon({
  dir,
  className = 'size-4',
}: {
  dir: 'left' | 'right' | 'down';
  className?: string;
}) {
  const d = dir === 'left' ? 'M10 3 5 8l5 5' : dir === 'right' ? 'M6 3l5 5-5 5' : 'M3 6l5 5 5-5';
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d={d} />
    </svg>
  );
}

export function MenuIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
    </svg>
  );
}

export function CloseIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  );
}

export function PanelIcon({ className = 'size-5' }: { className?: string }) {
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
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M6 3v10" />
    </svg>
  );
}

/** Our own mark: a rounded tile with a speech bubble, in the brand colour. */
export function BrandMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <path
        d="M9 11.5A3.5 3.5 0 0 1 12.5 8h7a3.5 3.5 0 0 1 3.5 3.5v5a3.5 3.5 0 0 1-3.5 3.5H15l-4 3.2V20A3.5 3.5 0 0 1 9 16.5v-5Z"
        fill="var(--brand-foreground)"
      />
    </svg>
  );
}
