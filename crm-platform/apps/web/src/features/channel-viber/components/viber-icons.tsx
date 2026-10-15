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

/** Viber purple, as Reference's screens use it (a brand colour of the channel, not of the product). */
export const VIBER = '#7360F2';

/** The channel's mark: Reference draws a "V" on a purple rounded square. */
export function ViberMark({
  className = 'size-10 rounded-xl text-[13px]',
}: {
  className?: string;
}) {
  return (
    <span
      className={`grid shrink-0 place-items-center font-bold text-white ${className}`}
      style={{ background: VIBER }}
      aria-hidden="true"
    >
      V
    </span>
  );
}

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
