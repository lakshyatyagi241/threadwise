import type { ReactNode } from 'react';
import { cn } from '@crm/ui';

/** Small stroke icons on a 16px grid, drawn like the shell's (currentColor, decorative). */
function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn('size-4 shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
type P = { className?: string };

export const ApiIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M5.5 3.5 2 8l3.5 4.5M10.5 3.5 14 8l-3.5 4.5M9 3l-2 10" />
  </Icon>
);
export const PlusIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);
export const SearchIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Icon>
);
export const LogsIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M3 4h10M3 8h10M3 12h6" />
  </Icon>
);
export const MoreIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="3.5" cy="8" r=".6" fill="currentColor" />
    <circle cx="8" cy="8" r=".6" fill="currentColor" />
    <circle cx="12.5" cy="8" r=".6" fill="currentColor" />
  </Icon>
);
export const CopyIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </Icon>
);
export const CheckIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="m3 8.5 3.2 3L13 4.5" />
  </Icon>
);
export const ImportIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M8 2.5v8M5 7.5l3 3 3-3M3 13h10" />
  </Icon>
);
export const ArrowLeftIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M13 8H3M7 4 3 8l4 4" />
  </Icon>
);
export const PlayIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />
  </Icon>
);
export const EditIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M10.5 3.5 12.5 5.5M3 13l.5-2.5 7-7 2 2-7 7z" />
  </Icon>
);
export const TrashIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" />
  </Icon>
);
export const FilterIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M2.5 3.5h11L9.5 8.5V13l-3-1.5V8.5z" />
  </Icon>
);
