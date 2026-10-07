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

export const PlusIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth="2">
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth="1.5">
    <circle cx="7" cy="7" r="5" />
    <path d="m11 11 3 3" />
  </Svg>
);
export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4l-4 4 4 4" />
  </Svg>
);
export const NextIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth="2">
    <path d="M6 4l4 4-4 4" />
  </Svg>
);
export const PrevIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth="2">
    <path d="M10 4l-4 4 4 4" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth="2.4">
    <path d="M3 8l3 3 7-8" />
  </Svg>
);
export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 2l3 3-8 8H3v-3l8-8z" />
  </Svg>
);
export const DuplicateIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="9" height="9" rx="1.5" />
    <rect x="6" y="6" width="7" height="7" rx="1.5" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4h10M6 4V2.5h4V4M5 4l1 9h4l1-9" />
  </Svg>
);
export const AgentIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M6 7.5a1.5 1.5 0 1 1 2.5 1.2c-.6.3-1 .7-1 1.3M8 11.2v.05" />
  </Svg>
);
