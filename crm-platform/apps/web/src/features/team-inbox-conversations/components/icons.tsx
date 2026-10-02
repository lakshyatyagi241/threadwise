import type { SVGProps } from 'react';

/** The inbox's small line icons. Decorative: every use sits beside text or inside a labelled button. */
function Icon({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);
/** Points to the start of the line: flips in a right-to-left page. */
export const BackIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} className={`rtl:rotate-180 ${p.className ?? ''}`}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);
export const PanelIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </Icon>
);
export const SendIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} className={`rtl:-scale-x-100 ${p.className ?? ''}`}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
  </Icon>
);
export const PaperclipIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m21 11-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />
  </Icon>
);
export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const ClockIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
export const AlertIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16.5v.01" />
  </Icon>
);
export const UserPlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M19 8v6M16 11h6" />
  </Icon>
);
export const CheckCircleIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.8 2.8L16 10" />
  </Icon>
);
export const RefreshIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M20 5v5h-5M4 19v-5h5M5.6 9A8 8 0 0 1 19 8M18.4 15A8 8 0 0 1 5 16" />
  </Icon>
);
export const InboxIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 13l3-8h12l3 8v6H3v-6Z" />
    <path d="M3 13h5l1 3h6l1-3h5" />
  </Icon>
);
export const FileIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
  </Icon>
);
export const PinIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Icon>
);
export const ArrowDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);
export const FlaskIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21.5h11.6a2 2 0 0 0 1.7-3L14 9V3" />
    <path d="M7.5 15h9" />
  </Icon>
);
export const NoteIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5 4h14v12l-4 4H5V4Z" />
    <path d="M15 20v-4h4M8 9h8M8 13h4" />
  </Icon>
);
export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);
export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} fill="currentColor">
    <path d="M8 5v14l11-7L8 5Z" />
  </Icon>
);
export const ExternalIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} className={`rtl:-scale-x-100 ${p.className ?? ''}`}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Icon>
);
export const ChannelsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 5h16v10H9l-5 4V5Z" />
  </Icon>
);
