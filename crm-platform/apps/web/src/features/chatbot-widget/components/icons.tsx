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
export const LaunchCheckIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth="2">
    <path d="M2 8l5 5 7-9" />
  </Svg>
);
export const ChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h5A2.5 2.5 0 0 1 13 5.5v3A2.5 2.5 0 0 1 10.5 11H8l-3.5 2v-2A2.5 2.5 0 0 1 3 8.5v-3Z" />
  </Svg>
);
export const EyeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
);
export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="9" height="9" rx="1.5" />
    <path d="M3 3h8M3 3v8" />
  </Svg>
);
export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 2l3 3-8 8H3v-3l8-8z" />
  </Svg>
);
export const RotateIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6M13 8a5 5 0 0 1-8.5 3.5L3 10M13 3v3h-3M3 13v-3h3" />
  </Svg>
);
export const DuplicateIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="9" height="9" rx="1.5" />
    <rect x="6" y="6" width="7" height="7" rx="1.5" fill="var(--background)" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4h10M6 4V2.5h4V4M5 4l1 9h4l1-9" />
  </Svg>
);
export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 3.5v9M10.5 3.5v9" />
  </Svg>
);
export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3l8 5-8 5z" />
  </Svg>
);
export const ExternalIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth="1.8">
    <path d="M3 13l10-10M6 3h7v7" />
  </Svg>
);
/** Bubble glyphs of the three engine tiles. */
export const EngineGlyph = ({ kind, ...p }: IconProps & { kind: 'ai' | 'whatsapp' | 'both' }) => (
  <Svg {...p}>
    {kind === 'ai' ? (
      <path d="M3 5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H8l-3 2v-2a2 2 0 0 1-2-2z" />
    ) : kind === 'whatsapp' ? (
      <path d="M13.5 8a5.5 5.5 0 1 1-2.2-4.4M3 13l.9-2.9M13.5 3v3h-3" />
    ) : (
      <>
        <path d="M2.5 4.5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2H6l-2 1.5V9a2 2 0 0 1-1.5-2z" />
        <path d="M10 9.5h1.5a2 2 0 0 0 2-2V6" />
      </>
    )}
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth="2">
    <path d="m4 6 4 4 4-4" />
  </Svg>
);

export const ChevronUpIcon = (p: IconProps) => (
  <Svg {...p} strokeWidth="2">
    <path d="m4 10 4-4 4 4" />
  </Svg>
);

/** The speech-bubble-and-handset mark of the WhatsApp launcher samples (drawn for the builder, not a brand asset). */
export const WhatsappGlyph = (p: IconProps) => (
  <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...p}>
    <path
      d="M16 4.5a11.3 11.3 0 0 0-9.7 17l-1.5 5.6 5.7-1.5A11.3 11.3 0 1 0 16 4.5z"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinejoin="round"
    />
    <path
      d="M12 10.5c-.7.7-1 1.6-.7 2.8.8 3.2 3.6 6 6.9 6.9 1.1.3 2-.1 2.6-.8l-1.8-2.1-1.6.8c-1.2-.5-2.4-1.7-2.9-2.9l.8-1.5z"
      fill="currentColor"
    />
  </svg>
);
