import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const CodeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 4L2.5 8 6 12M10 4l3.5 4L10 12" />
  </svg>
);
export const CopyIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="5" y="5" width="8" height="9" rx="1.5" />
    <path d="M3 11V3a1 1 0 0 1 1-1h6" />
  </svg>
);
export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);
export const KeyIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="6" cy="10" r="2.5" />
    <path d="M8 9l5-5M11 4l1.5 1.5M9.5 5.5L11 7" />
  </svg>
);
export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 4.5h10M6 4.5V3h4v1.5M5 4.5l.5 8h5l.5-8" />
  </svg>
);
export const InfoIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7v4M8 5v.01" />
  </svg>
);
export const AlertIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v4M8 11v.01" />
  </svg>
);
export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);
export const BackIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} className={`rtl:-scale-x-100 ${p.className ?? ''}`}>
    <path d="M10 4l-4 4 4 4" />
  </svg>
);
export const DocIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 2.5h6l3 3V13a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 4 13V3a.5.5 0 0 1 .5-.5Z" />
    <path d="M6.5 7.5h4M6.5 9.5h4" />
  </svg>
);
export const ArrowIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} className={`rtl:-scale-x-100 ${p.className ?? ''}`}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);
