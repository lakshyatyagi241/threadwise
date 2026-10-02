import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;
const Svg = (p: IconProps) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  />
);

/** The Telegram paper plane, as WaDesk draws it. */
export const TelegramGlyph = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M21.8 4.3 2.9 11.6c-1 .4-1 .95-.17 1.2l4.8 1.5 1.85 5.9c.24.66.43.9.9.9.35 0 .5-.16.7-.35l2.3-2.24 4.78 3.53c.88.48 1.5.23 1.72-.8l3.1-14.6c.32-1.28-.48-1.86-1.3-1.53z" />
  </svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg strokeWidth="2" {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3l-5 5 5 5" />
  </Svg>
);
export const ArrowRightIcon = (p: IconProps) => (
  <Svg strokeWidth="1.8" {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4h11M6 4V2.5h4V4M4.3 4l.6 9.5h6.2l.6-9.5" />
  </Svg>
);
export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4v8M10 4v8" />
  </Svg>
);
export const PlayIcon = (p: IconProps) => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M5 3l8 5-8 5z" />
  </svg>
);
export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.5 3.5v3h-3M2.5 12.5v-3h3" />
    <path d="M12.4 6a4.5 4.5 0 0 0-8.2-.8M3.6 10a4.5 4.5 0 0 0 8.2.8" />
  </Svg>
);
export const CardIcon = (p: IconProps) => (
  <Svg strokeWidth="1.5" {...p}>
    <rect x="2" y="4" width="12" height="8" rx="1.5" />
    <path d="M2 7h12M4.5 10h3" />
  </Svg>
);
export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M8 7.5v3M8 5.2h.01" />
  </Svg>
);
export const BulbIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 12h4M6.5 13.5h3M8 2a4 4 0 0 1 2.5 7.2c-.4.3-.5.6-.5 1H6c0-.4-.1-.7-.5-1A4 4 0 0 1 8 2Z" />
  </Svg>
);
export const PersonIcon = (p: IconProps) => (
  <Svg strokeWidth="1.4" {...p}>
    <circle cx="8" cy="5" r="3" />
    <path d="M2.5 13.5a5.5 5.5 0 0 1 11 0" />
  </Svg>
);
