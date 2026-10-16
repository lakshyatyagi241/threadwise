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
const Fill = (p: IconProps) => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...p} />
);

export const PlayIcon = (p: IconProps) => (
  <Fill {...p}>
    <polygon points="6,4 12,8 6,12" />
  </Fill>
);
export const PauseIcon = (p: IconProps) => (
  <Fill {...p}>
    <rect x="5" y="4" width="2" height="8" rx="0.5" />
    <rect x="9" y="4" width="2" height="8" rx="0.5" />
  </Fill>
);
export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3l2 2" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg strokeWidth="2" {...p}>
    <path d="M3 8l3 3 7-7" />
  </Svg>
);
export const WarnIcon = (p: IconProps) => (
  <Svg strokeWidth="1.8" {...p}>
    <path d="M8 1l7 13H1z" />
    <path d="M8 6v3M8 11.5h.01" />
  </Svg>
);
export const StopIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M5 5l6 6" />
  </Svg>
);
export const DraftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 2.5h6l2 2V13.5H4z" />
    <path d="M6 7h4M6 10h3" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg strokeWidth="2" {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6M13 8a5 5 0 0 1-8.5 3.5L3 10" />
    <path d="M13 3v3h-3M3 13v-3h3" />
  </Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </Svg>
);
export const ChartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" />
  </Svg>
);
export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" />
  </Svg>
);
export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 13.5l.7-3L11 2.7a1.5 1.5 0 0 1 2.1 2.1L5.5 12.8z" />
  </Svg>
);
export const ResendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.5 3.5v3h-3M2.5 12.5v-3h3" />
    <path d="M12.4 6a4.5 4.5 0 0 0-8.2-.8M3.6 10a4.5 4.5 0 0 0 8.2.8" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4h11M6 4V2.5h4V4M4.3 4l.6 9.5h6.2l.6-9.5" />
  </Svg>
);
export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3l-5 5 5 5" />
  </Svg>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3l5 5-5 5" />
  </Svg>
);
export const CalendarIcon = (p: IconProps) => (
  <Svg strokeWidth="1.5" {...p}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
  </Svg>
);
export const UsersIcon = (p: IconProps) => (
  <Svg strokeWidth="1.5" {...p}>
    <circle cx="6" cy="5.5" r="2.5" />
    <path d="M1.5 13a4.5 4.5 0 0 1 9 0M11 4a2.3 2.3 0 0 1 0 4.4M12.5 13a4 4 0 0 0-2-3.5" />
  </Svg>
);

/** The step icons of the two campaign steppers (the builder's five steps, the guided wizard's four). */
export const SlidersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6" />
    <circle cx="10" cy="5" r="1.5" />
    <circle cx="6" cy="11" r="1.5" />
  </Svg>
);
export const MessageIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3.5h10a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H8l-3 2.5V11H3a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
  </Svg>
);
export const ChecklistIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4.5l1.2 1.2 2-2M2.5 10l1.2 1.2 2-2M8 5h5.5M8 10.5h5.5" />
  </Svg>
);
export const TemplateIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M2.5 6h11M6 6v7.5" />
  </Svg>
);
export const SendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 2L7 9M14 2l-4.5 12-2.5-5.5L1.5 6 14 2z" />
  </Svg>
);
