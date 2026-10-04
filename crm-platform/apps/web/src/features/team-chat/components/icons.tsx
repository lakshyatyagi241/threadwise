import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4 shrink-0"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const HashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16" />
  </Svg>
);
export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 018 0v3" />
  </Svg>
);
export const PaperclipIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11.5l-8 8a5 5 0 01-7-7l8.5-8.5a3.5 3.5 0 015 5L10 17.5a2 2 0 01-3-3l7.5-7.5" />
  </Svg>
);
export const SendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z" />
  </Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Svg>
);
export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7" />
  </Svg>
);
export const UsersIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14.5a6.5 6.5 0 013.5 5.5" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
  </Svg>
);
export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5" />
  </Svg>
);
export const MessageIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h16v11H9l-5 4V5z" />
  </Svg>
);

export const GridIcon = (p: IconProps) => (
  <Svg viewBox="0 0 16 16" strokeWidth="1.6" {...p}>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </Svg>
);

export const ChatBubbleIcon = (p: IconProps) => (
  <Svg viewBox="0 0 16 16" strokeWidth="1.6" {...p}>
    <path d="M2 4c0-1 .8-2 2-2h8c1.2 0 2 1 2 2v6c0 1-.8 2-2 2H7l-3 3v-3H4c-1.2 0-2-1-2-2z" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg viewBox="0 0 16 16" strokeWidth="1.6" {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3l2 2" />
  </Svg>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <Svg viewBox="0 0 16 16" strokeWidth="1.6" {...p}>
    <path d="M14 8H3M6 5L3 8l3 3" />
  </Svg>
);

export const ChannelGlyphIcon = (p: IconProps) => (
  <Svg viewBox="0 0 16 16" strokeWidth="1.7" {...p}>
    <path d="M3 6h10M3 10h10M5 2v12M11 2v12" />
  </Svg>
);
