import type { SVGProps } from 'react';

/** Small line icons for the shop (the shop does not use the staff app's icon set). All are decorative: buttons carry the labels. */
type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
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

export const SearchIcon = (p: P) => (
  <Svg {...p} strokeWidth={1.7}>
    <circle cx="7" cy="7" r="5" />
    <path d="m11 11 3 3" />
  </Svg>
);
export const HeartIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 13.4S2 10 2 6.2A3.2 3.2 0 0 1 8 4.4 3.2 3.2 0 0 1 14 6.2c0 3.8-6 7.2-6 7.2Z" />
  </Svg>
);
export const CompareIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="4" width="5" height="9" rx="1" />
    <rect x="9" y="4" width="5" height="9" rx="1" />
  </Svg>
);
export const CartIcon = (p: P) => (
  <Svg {...p} strokeWidth={1.7}>
    <path d="M2 3h2l1.5 8h7l1-5H6" />
    <circle cx="6" cy="13.5" r="1.1" />
    <circle cx="12" cy="13.5" r="1.1" />
  </Svg>
);
export const EyeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M1.5 8s2.5-5 6.5-5 6.5 5 6.5 5-2.5 5-6.5 5-6.5-5-6.5-5z" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
);
export const ShareIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="4" cy="8" r="2" />
    <circle cx="12" cy="4" r="2" />
    <circle cx="12" cy="12" r="2" />
    <path d="m6 7 4-2M6 9l4 2" />
  </Svg>
);
export const CheckIcon = (p: P) => (
  <Svg strokeWidth={1.7} {...p}>
    <path d="m3 8 3 3 7-7" />
  </Svg>
);
export const GridIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="2" width="5" height="5" />
    <rect x="9" y="2" width="5" height="5" />
    <rect x="2" y="9" width="5" height="5" />
    <rect x="9" y="9" width="5" height="5" />
  </Svg>
);
export const ListIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2 4h12M2 8h12M2 12h12" />
  </Svg>
);
export const ChevronDownIcon = (p: P) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M3 6l5 5 5-5" />
  </Svg>
);
export const CloseIcon = (p: P) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </Svg>
);
export const MailIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="m2 4 6 5 6-5" />
  </Svg>
);
export const UploadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 2v8M5 5l3-3 3 3M3 10v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" />
  </Svg>
);
export const CardIcon = (p: P) => (
  <Svg {...p} strokeWidth={1.7}>
    <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
    <path d="M2 6.5h12" />
  </Svg>
);

export const WhatsAppIcon = ({ size = 16, ...rest }: P) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M17.5 14.4c-.3-.1-1.5-.7-1.8-.8-.2-.1-.4-.1-.5.1-.2.3-.7.8-.8 1-.1.1-.3.2-.6.1-.3-.1-1.2-.4-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.4.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.5-1.3-.7-1.8-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.4.1-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3 4.8 4.2 1.7.7 2.3.8 3.1.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2 0-.1-.2-.2-.5-.3zM12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.5A10 10 0 1 0 12 2z" />
  </svg>
);
export const TelegramIcon = ({ size = 16, ...rest }: P) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M22 4 2 11.5l5.5 2 2 6.5 3-3.5 5.5 4Z" />
  </svg>
);

/** The image fallback: a monochrome package glyph, so a broken or missing image never shows the browser's icon. */
export const PackageIcon = ({ size = 34, ...rest }: P) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.4}
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
    <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
  </svg>
);

export const BagIcon = ({ size = 64, ...rest }: P) => (
  <svg
    viewBox="0 0 64 64"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.2}
    opacity={0.4}
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M14 18h36l-3 28a4 4 0 0 1-4 3.5H21a4 4 0 0 1-4-3.5L14 18Z" />
    <path d="M22 18v-4a10 10 0 0 1 20 0v4" />
  </svg>
);
export const BigHeartIcon = ({ size = 64, ...rest }: P) => (
  <svg
    viewBox="0 0 64 64"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.2}
    opacity={0.4}
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M32 50s-16-10-16-22a8 8 0 0 1 16-3 8 8 0 0 1 16 3c0 12-16 22-16 22Z" />
  </svg>
);
export const BigCompareIcon = ({ size = 64, ...rest }: P) => (
  <svg
    viewBox="0 0 64 64"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.2}
    opacity={0.4}
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <rect x="6" y="14" width="22" height="36" rx="3" />
    <rect x="36" y="14" width="22" height="36" rx="3" />
  </svg>
);
