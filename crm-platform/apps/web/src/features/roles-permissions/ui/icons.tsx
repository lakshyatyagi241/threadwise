import type { SVGProps } from 'react';
import { cn } from '@crm/ui';

function Icon({ children, className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('size-3.5 shrink-0', className)}
      {...props}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;

export const ShieldIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 2l5 2v4c0 3.2-2 5.4-5 6-3-.6-5-2.8-5-6V4z" />
  </Icon>
);
export const LockIcon = (p: P) => (
  <Icon {...p}>
    <rect x="2" y="6" width="12" height="8" rx="1.5" />
    <path d="M5 6V4a3 3 0 0 1 6 0v2" />
  </Icon>
);
export const PlusIcon = (p: P) => (
  <Icon strokeWidth="2" {...p}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);
export const CheckSmallIcon = (p: P) => (
  <Icon strokeWidth="2" {...p}>
    <path d="M2 8l5 5 7-9" />
  </Icon>
);
export const SearchIcon = (p: P) => (
  <Icon strokeWidth="1.5" {...p}>
    <circle cx="7" cy="7" r="5" />
    <path d="m11 11 3 3" />
  </Icon>
);
export const DotsIcon = (p: P) => (
  <Icon fill="currentColor" stroke="none" {...p}>
    <circle cx="3" cy="8" r="1.2" />
    <circle cx="8" cy="8" r="1.2" />
    <circle cx="13" cy="8" r="1.2" />
  </Icon>
);
export const EditIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9.5 3.5 12.5 6.5 6 13H3v-3z" />
  </Icon>
);
export const TrashIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 4h10M6 4V2.8h4V4M5 6v8h6V6" />
  </Icon>
);
export const PersonIcon = (p: P) => (
  <Icon strokeWidth="1.5" {...p}>
    <circle cx="6" cy="6" r="3" />
    <path d="M2 14c0-3 2.5-5 4-5s4 2 4 5" />
  </Icon>
);
export const ChevronSmallIcon = (p: P) => (
  <Icon strokeWidth="1.6" viewBox="0 0 12 12" {...p}>
    <path d="M4 3l3 3-3 3" />
  </Icon>
);
