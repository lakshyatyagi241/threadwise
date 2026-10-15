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

/** LINE's green. */
export const LINE_GREEN = '#06C755';

/** The LINE speech bubble. */
export const LineGlyph = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12 2.5C6.5 2.5 2 6.1 2 10.5c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5s5.8-3.4 7.9-5.8c1.4-1.6 2.1-3.2 2.1-5C22 6.1 17.5 2.5 12 2.5z" />
  </svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg strokeWidth="2" {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3l-5 5 5 5" />
  </Svg>
);
export const SendIcon = (p: IconProps) => (
  <Svg strokeWidth="2" {...p}>
    <path d="M2 8l12-5-4 12-2.5-4.5L2 8z" />
  </Svg>
);
export const ChevronIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4l4 4-4 4" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4h11M6 4V2.5h4V4M4.3 4l.6 9.5h6.2l.6-9.5" />
  </Svg>
);
export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4v8M10 4v8" />
  </Svg>
);
