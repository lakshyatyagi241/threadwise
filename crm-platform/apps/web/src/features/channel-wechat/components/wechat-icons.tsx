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

/** WeChat's green. */
export const WECHAT_GREEN = '#07C160';

/** The "W" badge Reference puts on every WeChat card. */
export function WechatBadge({ className = 'size-10 text-[13px]' }: { className?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-xl font-bold text-white ${className}`}
      style={{ background: WECHAT_GREEN }}
      aria-hidden="true"
    >
      W
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
