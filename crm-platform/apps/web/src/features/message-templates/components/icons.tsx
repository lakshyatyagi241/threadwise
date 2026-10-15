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
export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6M13 8a5 5 0 0 1-8.5 3.5L3 10" />
    <path d="M13 3v3h-3M3 13v-3h3" />
  </Svg>
);
export const ImageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="6" cy="6.5" r="1.2" />
    <path d="m3 12 3-3 2.5 2 2-1.5L13 12" />
  </Svg>
);
export const VideoIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
    <path d="M6.5 6.5 10 8l-3.5 1.5z" />
  </Svg>
);
export const DocumentIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 1.5h5l3 3V14a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 14zM9 1.5V4.5h3M6 8h4M6 10.5h4" />
  </Svg>
);
export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 14s4.5-4 4.5-7A4.5 4.5 0 0 0 8 2.5 4.5 4.5 0 0 0 3.5 7c0 3 4.5 7 4.5 7z" />
    <circle cx="8" cy="7" r="1.5" />
  </Svg>
);
export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8" />
  </Svg>
);
export const PhoneIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 2.5h2l1 3-1.5 1a7 7 0 0 0 4 4l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A10 10 0 0 1 2 4a1.5 1.5 0 0 1 1.5-1.5z" />
  </Svg>
);
export const ReplyIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4 2.5 7.5 6 11M2.5 7.5H10a3.5 3.5 0 0 1 3.5 3.5V12" />
  </Svg>
);
export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="5" width="8" height="8.5" rx="1.2" />
    <path d="M3 10.5V3.2A1.2 1.2 0 0 1 4.2 2H10" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" />
  </Svg>
);
export const ArrowUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Svg>
);
export const ArrowDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Svg>
);
export const ArrowLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 8H3M7 4 3 8l4 4" />
  </Svg>
);
/** The double tick WhatsApp draws next to the time of a sent message. */
export const CheckIcon = (p: IconProps) => (
  <svg
    viewBox="0 0 18 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    <path d="M1 6.5 4 9.5 9.5 3M7.5 9.5l1-1M9 6.5 13.5 2" />
  </svg>
);
export const TickIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3.5 8.5 3 3 6-6" />
  </Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);
export const EyeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="1.8" />
  </Svg>
);
export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m11 3 2 2-7 7H4v-2z" />
  </Svg>
);
export const TemplateIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M2.5 6h11M6 6v7.5" />
  </Svg>
);
export const ChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.6 11.2 2 14l2.9-.6A6 6 0 1 0 2.6 11.2Z" />
  </Svg>
);
export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.5 14 13H2L8 2.5zM8 7v3M8 11.5v.01" />
  </Svg>
);
export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" strokeDasharray="20 8" />
  </Svg>
);
export const SendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 6v4l8 3V3L2 6Zm8-1 3-1v8l-3-1" />
  </Svg>
);
export const DotIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.5" />
  </Svg>
);
export const CodeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
  </Svg>
);
