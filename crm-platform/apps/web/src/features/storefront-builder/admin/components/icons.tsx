import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/** A 16x16 outline icon drawn from path data (the sidebar's section icons). */
export function PathIcon({ d, className = 'size-3.5', ...rest }: IconProps & { d: string }) {
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
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}

function Svg({ children, className = 'size-4', ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const StoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 5h10l-1 9H4z" />
    <path d="M5 5a3 3 0 1 1 6 0" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const ArrowIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Svg>
);
export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4l-4 4 4 4" />
  </Svg>
);
export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 3h2v2M13 3l-6 6M9 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7" />
  </Svg>
);
export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 2l3 3-8 8H3v-3z" />
  </Svg>
);
export const ShareIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="4" cy="8" r="2" />
    <circle cx="12" cy="4" r="2" />
    <circle cx="12" cy="12" r="2" />
    <path d="m6 7 4-2M6 9l4 2" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5 4l1 9a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1l1-9" />
  </Svg>
);
export const MailIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="m2 4 6 5 6-5" />
  </Svg>
);
export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2v8M5 5l3-3 3 3M3 10v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" />
  </Svg>
);
export const SendIcon = (p: IconProps) => (
  <Svg {...p} fill="currentColor" stroke="none" viewBox="0 0 24 24">
    <path d="M22 4 2 11.5l5.5 2 2 6.5 3-3.5 5.5 4Z" />
  </Svg>
);
export const WhatsAppIcon = (p: IconProps) => (
  <Svg {...p} fill="none" viewBox="0 0 24 24" strokeWidth="1.6">
    <path d="M20.5 12A8.5 8.5 0 1 1 4.6 16.3L3.5 20.5l4.3-1.1A8.5 8.5 0 0 0 20.5 12Z" />
  </Svg>
);
export const PhoneIcon = (p: IconProps) => (
  <Svg {...p} viewBox="0 0 24 24" strokeWidth="1.7">
    <rect x="7" y="2" width="10" height="20" rx="2" />
    <path d="M11 18h2" />
  </Svg>
);
export const CloudIcon = (p: IconProps) => (
  <Svg {...p} viewBox="0 0 24 24" strokeWidth="1.7">
    <path d="M12 21a9 9 0 1 0-8.5-6" />
    <path d="M3 21l1.5-4.5" />
  </Svg>
);
export const ChevronIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 4 4 4-4 4" />
  </Svg>
);
