import type { ComponentType, SVGProps } from 'react';
import { KeyIcon, TrashIcon, UserIcon } from '../../shared/icons';
import type { HubIcon } from './hub-tabs';

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

const PlanIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-6h4v6" />
  </Svg>
);

const GenericIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Svg>
);

const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);

export const HUB_ICONS: Record<HubIcon, ComponentType<IconProps>> = {
  user: UserIcon,
  plan: PlanIcon,
  key: KeyIcon,
  trash: TrashIcon,
  generic: GenericIcon,
};

export { LockIcon };
