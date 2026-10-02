import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

/** The Shopify bag mark, in the brand greens. */
export function ShopifyGlyph(props: P) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <path
        fill="#95BF47"
        d="M22.5 7.6c0-.1-.1-.2-.2-.2L20.5 7l-1.4-1.4c-.1-.1-.4-.1-.5 0L17 6c-.7-2-2.4-2.5-3.6-2.1-2.6.8-3.8 4-4.5 6 0 0-1.7.5-1.8.5-.9.3-1 .3-1.1 1.2L4.5 27.6 19.7 30l8.2-1.8L22.5 7.6z"
      />
      <path
        fill="#5E8E3E"
        d="M22.3 7.4c-.1 0-1.7-.1-1.7-.1s-1.4-1.3-1.5-1.5c-.1-.1-.2-.1-.2-.1L19.7 30l8.2-1.8L22.5 7.6s-.1-.2-.2-.2z"
      />
      <path
        fill="#fff"
        d="M16.4 11.7l-.9 3.4s-1-.5-2.2-.4c-1.8.1-1.8 1.2-1.8 1.5.1 1.5 4.1 1.9 4.3 5.5.2 2.8-1.5 4.7-3.9 4.9-2.9.2-4.5-1.5-4.5-1.5l.6-2.6s1.6 1.2 2.9 1.1c.8-.1 1.1-.7 1.1-1.2-.1-2-3.4-1.9-3.6-5.1-.2-2.7 1.6-5.5 5.5-5.7 1.5-.1 2.5.2 2.5.2z"
      />
    </svg>
  );
}

/** The WooCommerce speech-bubble mark, in its purple. */
export function WooGlyph(props: P) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <rect x="2" y="5" width="28" height="18" rx="5" fill="#7F54B3" />
      <path d="M10 23l-2 5 7-5z" fill="#7F54B3" />
      <path
        fill="#fff"
        d="M7 11.2c.2-.4.6-.6 1-.6s.8.3.9.7l1 4.8 1.7-4.4c.2-.4.5-.6.9-.6s.8.2.9.6l1.7 4.4 1-4.8c.1-.5.5-.7.9-.7s.9.2 1 .6c0 .2 0 .4 0 .6l-1.6 6.1c-.1.5-.5.8-1 .8s-.8-.2-1-.7l-1.6-4.2-1.6 4.2c-.2.5-.5.7-1 .7s-.9-.3-1-.8l-1.6-6.1c0-.2 0-.4 0-.6z"
      />
    </svg>
  );
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export const SyncIcon = (p: P) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" {...stroke} {...p}>
    <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6M13 8a5 5 0 0 1-8.5 3.5L3 10M13 3v3h-3M3 13v-3h3" />
  </svg>
);
export const SendIcon = (p: P) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" {...stroke} {...p}>
    <path d="M14 2 2 7l4 1.5L8.5 13 14 2Z" />
  </svg>
);
export const CheckIcon = (p: P) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" {...stroke} {...p}>
    <path d="m4 8 3 3 5-6" />
  </svg>
);
export const SearchIcon = (p: P) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" {...stroke} {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </svg>
);
export const BackIcon = (p: P) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" {...stroke} {...p}>
    <path d="M10 4l-4 4 4 4" />
  </svg>
);
export const AlertIcon = (p: P) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" {...stroke} {...p}>
    <path d="M8 5v3M8 11v.01" />
    <circle cx="8" cy="8" r="6" />
  </svg>
);
export const UnplugIcon = (p: P) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" {...stroke} {...p}>
    <path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0V5ZM8 11v3" />
  </svg>
);
