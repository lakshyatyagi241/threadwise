import type { SVGProps } from 'react';

/** Facebook's blue, the one colour WaDesk's Facebook screens carry on every button and chip. */
export const FB_BLUE = '#1877F2';
/** Messenger's blue (the Get Started button and the chips in the previews). */
export const MESSENGER_BLUE = '#0084FF';

type P = SVGProps<SVGSVGElement>;

const stroke = (props: P) => ({
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
});

export const FacebookGlyph = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
    <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46H15.2c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.45 2.89h-2.33v6.99A10 10 0 0 0 22 12Z" />
  </svg>
);

export const RefreshIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M13.5 3.5v3h-3M2.5 12.5v-3h3" />
    <path d="M12.6 6.5A5 5 0 0 0 4 5M3.4 9.5A5 5 0 0 0 12 11" />
  </svg>
);
export const TrashIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M2.5 4h11M6 4V2.5h4V4M4.3 4l.6 9.5h6.2l.6-9.5" />
  </svg>
);
export const PlusIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.8, ...p })}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);
export const CloseIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.6, ...p })}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
export const ChevronDownIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.7, ...p })}>
    <path d="M4 6l4 4 4-4" />
  </svg>
);
export const SendIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M14 2 7 9M14 2l-4.5 12-2.5-5-5-2.5L14 2Z" />
  </svg>
);
export const ImageIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.5, ...p })}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <circle cx="6" cy="6" r="1.3" />
    <path d="M3.5 11l3-3 2.5 2.5L11 8l1.5 1.5" />
  </svg>
);
export const AlbumIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.5, ...p })}>
    <rect x="4" y="4" width="8" height="8" rx="1.5" />
    <path d="M2.5 5.5v5M13.5 5.5v5" />
  </svg>
);
export const LinkIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.5, ...p })}>
    <path d="M6.5 9.5a3 3 0 0 0 4 0l2-2a3 3 0 0 0-4-4l-1 1" />
    <path d="M9.5 6.5a3 3 0 0 0-4 0l-2 2a3 3 0 0 0 4 4l1-1" />
  </svg>
);
export const VideoIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.5, ...p })}>
    <rect x="2.5" y="3.5" width="11" height="9" rx="2" />
    <path d="M6.5 6l3 2-3 2z" />
  </svg>
);
export const ReelIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.5, ...p })}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <path d="M6.5 5.5l4 2.5-4 2.5z" />
  </svg>
);
export const GridIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.6, ...p })}>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </svg>
);
export const ListIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.6, ...p })}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />
  </svg>
);
export const SearchIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.5, ...p })}>
    <circle cx="7" cy="7" r="5" />
    <path d="M11 11l3 3" />
  </svg>
);
export const InfoIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 7v4M8 5h.01" />
  </svg>
);
export const PeopleIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M6 6a2 2 0 1 1 0-.01M3 13c0-2 1.5-3 3-3s3 1 3 3M11 5.5a2 2 0 1 1 0 4M11.5 13c0-2-1-2.8-1-2.8" />
  </svg>
);
export const CheckBoxIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M6 8l1.5 1.5L11 6M2.5 3.5h11v9h-11z" />
  </svg>
);
export const SparkIcon = (p: P) => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden {...p}>
    <path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6L8 1z" />
  </svg>
);
export const GetStartedIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.5, ...p })}>
    <path d="M4 8h8M8 4l4 4-4 4" />
  </svg>
);
export const GreetingIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.5, ...p })}>
    <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h5A2.5 2.5 0 0 1 13 5.5v3A2.5 2.5 0 0 1 10.5 11H8l-3.5 2v-2A2.5 2.5 0 0 1 3 8.5z" />
  </svg>
);
export const MenuIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.5, ...p })}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </svg>
);
export const QuestionIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.5, ...p })}>
    <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM6 6.5a2 2 0 0 1 4 0c0 1.5-2 1.5-2 3M8 12h.01" />
  </svg>
);
export const PhoneIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.5, ...p })}>
    <path d="M4 2.5h8v11H4zM6.5 12.5h3" />
  </svg>
);
