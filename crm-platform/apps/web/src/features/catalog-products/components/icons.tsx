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

export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Svg>
);
export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4l-4 4 4 4" />
  </Svg>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 4 4 4-4 4" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="5" />
    <path d="m11 11 3 3" />
  </Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 8 3 3 7-7" />
  </Svg>
);
export const BoxIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 5l6-3 6 3v6l-6 3-6-3z" />
    <path d="M2 5l6 3 6-3M8 8v6" />
  </Svg>
);
export const ImageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="6" cy="7" r="1" />
    <path d="m3 12 3-3 2 2 3-3 2 2" />
  </Svg>
);
export const SyncIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 8a6 6 0 0 1 11-3M14 8a6 6 0 0 1-11 3" />
    <path d="M13 2v3h-3M3 14v-3h3" />
  </Svg>
);
export const PollIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 8a6 6 0 1 1 12 0 6 6 0 0 1-12 0z" />
    <path d="m6 8 2 2 4-4" />
  </Svg>
);
export const ImportIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2v8M5 7l3 3 3-3M2.5 13.5h11" />
  </Svg>
);
export const SendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 8l12-5-5 12-2.5-4.5z" />
  </Svg>
);
export const PhoneIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth="1.7">
    <rect x="4" y="1.5" width="8" height="13" rx="1.5" />
    <path d="M7 12h2" />
  </Svg>
);
export const CollectionsIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </Svg>
);
export const LinkListIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth="1.7">
    <path d="M3 4.5h10M3 8h10M3 11.5h6.5" />
    <path d="M13.5 10l1.5 1.5-1.5 1.5" />
  </Svg>
);
export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3.5M8 11h.01" />
  </Svg>
);
export const PriceIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2v12M5 5.5h4.5a1.8 1.8 0 0 1 0 3.5H6a1.8 1.8 0 0 0 0 3.5h5" />
  </Svg>
);
export const ChatIcon = (p: IconProps) => (
  <Svg {...p} viewBox="0 0 24 24" strokeWidth="1.6">
    <path d="M20.5 12A8.5 8.5 0 1 1 4.6 16.3L3.5 20.5l4.3-1.1A8.5 8.5 0 0 0 20.5 12Z" />
    <path d="M12 8v4M12 16h.01" />
  </Svg>
);
export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Svg>
);
