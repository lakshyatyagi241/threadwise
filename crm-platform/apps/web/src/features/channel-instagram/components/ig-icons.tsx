import { useId, type SVGProps } from 'react';

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

/** Instagram's camera outline in the brand gradient (Reference's row marks the channel with it). */
export function InstagramGradientGlyph(props: P) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={`url(#${id})`}
      strokeWidth={2}
      aria-hidden
      {...props}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#F58529" />
          <stop offset=".5" stopColor="#DD2A7B" />
          <stop offset="1" stopColor="#8134AF" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="#DD2A7B" stroke="none" />
    </svg>
  );
}

/** The plain camera glyph, in the current colour. */
export const InstagramGlyph = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.4, ...p })}>
    <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3.4" />
    <circle cx="8" cy="8" r="2.9" />
    <circle cx="11.3" cy="4.7" r="0.7" fill="currentColor" stroke="none" />
  </svg>
);

export const RefreshIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M13.5 3.5v3h-3M2.5 12.5v-3h3" />
    <path d="M12.4 6a4.5 4.5 0 0 0-8.2-.8M3.6 10a4.5 4.5 0 0 0 8.2.8" />
  </svg>
);

export const TrashIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M2.5 4h11M6 4V2.5h4V4M4.3 4l.6 9.5h6.2l.6-9.5" />
  </svg>
);

export const ExternalIcon = (p: P) => (
  <svg {...stroke(p)}>
    <path d="M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5M9 3.5h4v4M13 3.5 7.5 9" />
  </svg>
);

export const PlusIcon = (p: P) => (
  <svg {...stroke({ strokeWidth: 1.8, ...p })}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);
