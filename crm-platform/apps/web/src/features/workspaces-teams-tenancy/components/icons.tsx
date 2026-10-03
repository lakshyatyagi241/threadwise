import type { ReactNode } from 'react';

function Icon({ children, className = 'size-3.5' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PlusIcon = ({ className = 'size-3' }: { className?: string }) => (
  <Icon className={className}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);
export const SearchIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="7" cy="7" r="5" />
    <path d="m11 11 3 3" />
  </Icon>
);
export const LockIcon = () => (
  <Icon>
    <path d="M11 6V4.5a3 3 0 0 0-6 0V6M3.5 6h9v7h-9zM8 9v2" />
  </Icon>
);
export const TrashIcon = () => (
  <Icon>
    <path d="M3 4h10M6 4V2.5h4V4M5 4l1 9h4l1-9" />
  </Icon>
);
export const MailIcon = () => (
  <Icon>
    <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
    <path d="m2.5 4.5 5.5 4 5.5-4" />
  </Icon>
);
export const PencilIcon = () => (
  <Icon>
    <path d="M11 2l3 3-8 8H3v-3l8-8z" />
  </Icon>
);
export const CloseIcon = ({ className = 'size-4' }: { className?: string }) => (
  <Icon className={className}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);
export const InfoIcon = ({ className = 'size-3' }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3l2 2" />
  </Icon>
);
