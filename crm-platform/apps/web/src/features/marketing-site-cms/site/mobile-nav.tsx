'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export interface MobileNavLink {
  href: string;
  label: string;
}

/** The hamburger button and the full-screen menu of the public site's navigation (below the `lg` breakpoint). */
export function MobileNav({
  links,
  primary,
  secondary,
  openLabel,
  closeLabel,
}: {
  links: MobileNavLink[];
  primary: MobileNavLink;
  secondary: MobileNavLink | null;
  openLabel: string;
  closeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="fc-mobile-menu"
        aria-label={open ? closeLabel : openLabel}
        onClick={() => setOpen((v) => !v)}
        className="relative z-50 p-2 text-ink-700 hover:text-ink-900 focus:outline-none lg:hidden"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d={open ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
        </svg>
      </button>
      <div
        id="fc-mobile-menu"
        hidden={!open}
        className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-white px-7 pb-7 pt-20 lg:hidden"
      >
        <div className="mt-4 flex flex-col gap-6 text-[18px] font-medium">
          {links.map((l) => (
            <Link
              key={l.href + l.label}
              href={l.href}
              onClick={close}
              className="border-b border-paper-200 pb-4 text-ink-900 hover:text-wa-deep"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="mt-8 flex flex-col gap-4">
          <Link
            href={primary.href}
            onClick={close}
            className="w-full rounded-full bg-wa-deep py-4 text-center text-[16px] font-semibold text-paper-0 hover:bg-wa-teal"
          >
            {primary.label}
          </Link>
          {secondary && (
            <Link
              href={secondary.href}
              onClick={close}
              className="w-full rounded-full bg-paper-100 py-4 text-center text-[16px] font-semibold text-ink-900 hover:bg-paper-200"
            >
              {secondary.label}
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
