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

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
  </Svg>
);
export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />
  </Svg>
);
export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </Svg>
);
export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </Svg>
);
export const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" />
    <rect x="4" y="13" width="7" height="7" rx="1" />
    <rect x="13" y="13" width="7" height="7" rx="1" />
  </Svg>
);
export const UsersPlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6M19 8v6M16 11h6" />
  </Svg>
);
export const UsersIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" />
  </Svg>
);
export const MergeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4v4a4 4 0 004 4h4a4 4 0 014 4v4M6 20v-4" />
  </Svg>
);
export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);
export const XIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5" />
  </Svg>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 9l7 7 7-7" />
  </Svg>
);
export const ColumnsIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16M15 4v16" />
  </Svg>
);
export const FilterIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h16l-6 8v6l-4-2v-4L4 5z" />
  </Svg>
);
export const SendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z" />
  </Svg>
);
export const BookUserIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4h12a2 2 0 012 2v14H7a2 2 0 01-2-2V4z" />
    <circle cx="12" cy="10" r="2.5" />
    <path d="M8 16.5c.6-1.6 2-2.3 4-2.3s3.4.7 4 2.3M5 8H3M5 12H3M5 16H3" />
  </Svg>
);
