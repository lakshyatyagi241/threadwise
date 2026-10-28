'use client';

import type { AuthPageContent, AuthPageName } from '@crm/contracts';
import { cn } from '@crm/ui';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import { safeUrl } from './safe-url';

/**
 * Pieces of the auth-page designs (TW-AUTH-021). Everything here is driven by props and
 * messages, with no session or router access, so the admin editor can render it as a preview.
 */

export const FEATURE_INDEXES = [1, 2, 3, 4] as const;
export const STAT_INDEXES = [1, 2, 3] as const;
export const CHIP_INDEXES = [1, 2, 3, 4, 5, 6] as const;

/** Reads one showcase copy field: the admin's text when set, otherwise our own default. */
export function useShowcaseCopy(page: AuthPageName, extra?: Record<string, string>) {
  const t = useTranslations('auth-registration-security.guest.shell');
  return (key: string): string => {
    const custom = extra?.[key]?.trim();
    if (custom) return custom;
    const path = `defaults.${page}.${key}`;
    return t.has(path) ? t(path) : '';
  };
}

const ICONS = [
  'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
];

export function Glyph({ index, className }: { index: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? 'size-4'}
    >
      <path d={ICONS[index % ICONS.length]} />
    </svg>
  );
}

/** Full-bleed or boxed media from the admin: image, GIF, or a muted looping video. */
export function AuthMedia({
  content,
  className,
}: {
  content: Pick<AuthPageContent, 'mediaUrl' | 'mediaType'>;
  className?: string;
}) {
  const src = safeUrl(content.mediaUrl);
  if (!src) return null;
  if (content.mediaType === 'video') {
    return (
      <video
        className={`motion-reduce:hidden ${className ?? ''}`}
        src={src}
        autoPlay
        muted
        loop
        playsInline
        disablePictureInPicture
        aria-hidden="true"
        tabIndex={-1}
      />
    );
  }
  return <img src={src} alt="" aria-hidden="true" className={className} />;
}

type HeadingTone = 'accent' | 'deep' | 'plain' | 'soft';

/**
 * "heading <accent word>.": the accent word is italic (not in scripts where italics read badly) and takes the
 * colour of the tone: the admin's accent on dark art, the deep green on paper, none on a gradient panel.
 */
export function AccentHeading({
  heading,
  accent,
  tone,
}: {
  heading?: string;
  accent?: string;
  tone: HeadingTone;
}) {
  const style: CSSProperties | undefined =
    tone === 'accent'
      ? { color: 'var(--auth-accent-dark)' }
      : tone === 'deep'
        ? { color: 'var(--auth-link)' }
        : tone === 'soft'
          ? { opacity: 0.9 }
          : undefined;
  return (
    <>
      {heading}
      {heading && accent ? ' ' : null}
      {accent ? <span style={style}>{accent}</span> : null}
      {heading || accent ? '.' : null}
    </>
  );
}

/** Geta's logo for design 6, a picture hosted outside this app (swap the address here to change it). */
export const GETA_LOGO_URL =
  'https://ci3.googleusercontent.com/mail-sig/AIorK4wAnlEhcIIYJ558cB7za1t6U844T7z0JH3CJfssd5vNBbjbURNBlLXD4cV_v060A86DcgjDG84';

/** Design 6's mark: Geta's own logo picture (the product name is its alt text), not the shared brand mark. */
export function GetaMark({ name, className }: { name: string; className?: string }) {
  return (
    <img
      src={GETA_LOGO_URL}
      alt={name}
      // The picture lives on another site: send it no referrer, so a visitor's page address is not passed along.
      referrerPolicy="no-referrer"
      decoding="async"
      // The picture has dark lettering: in dark mode it sits on a white rounded chip so it stays readable.
      className={cn(
        'h-9 w-auto max-w-full dark:box-content dark:rounded-lg dark:bg-white dark:px-2 dark:py-1',
        className,
      )}
    />
  );
}

const GETA_SHAPES = [
  {
    className: 'auth-geta-shape size-10 bg-amber-500/80',
    style: { top: '13%', right: '18%', '--geta-rot': '45deg' } as CSSProperties,
  },
  {
    className: 'auth-geta-shape auth-geta-shape--slow size-6 rounded-[3px] bg-amber-400/70',
    style: { top: '26%', right: '30%', '--geta-rot': '-12deg' } as CSSProperties,
  },
  {
    className: 'auth-geta-shape auth-geta-shape--fast size-4 rounded-[2px] bg-orange-400/60',
    style: { top: '35%', right: '10%', '--geta-rot': '30deg' } as CSSProperties,
  },
] as const;

const GETA_STARS = [
  ['8%', '12%', 2, '0s'],
  ['14%', '58%', 3, '1.2s'],
  ['22%', '40%', 2, '2.1s'],
  ['31%', '8%', 3, '0.6s'],
  ['40%', '72%', 2, '1.8s'],
  ['47%', '28%', 2, '2.6s'],
  ['55%', '90%', 3, '0.9s'],
  ['63%', '14%', 2, '1.5s'],
  ['71%', '52%', 2, '2.9s'],
  ['86%', '34%', 3, '0.3s'],
  ['92%', '78%', 2, '2.3s'],
] as const;

const WAVE_A =
  'M0 60 C 150 20, 300 100, 450 60 S 750 20, 900 60 S 1200 100, 1350 60 S 1650 20, 1800 60 V120 H0 Z';
const WAVE_B = 'M0 70 C 200 110, 350 30, 600 70 S 950 110, 1200 70 S 1500 30, 1800 70 V120 H0 Z';

/** Design 6's moving backdrop: orbit rings round the big amber square, twinkling stars, large arcs and waves along the bottom. */
export function GetaSky() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute size-10" style={{ top: '13%', right: '18%' }}>
        <span className="auth-geta-ring absolute -inset-[26px] rounded-full border border-white/15" />
        <span className="auth-geta-ring auth-geta-ring--dashed absolute -inset-[44px] rounded-full border border-dashed border-white/15" />
        <span className="auth-geta-orbit absolute -inset-[26px]">
          <span className="absolute start-1/2 top-0 size-2.5 -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-400 shadow-[0_0_12px_3px_rgb(167_139_250/0.7)]" />
        </span>
        <span className="auth-geta-orbit auth-geta-orbit--rev absolute -inset-[44px]">
          <span className="absolute bottom-0 start-1/2 size-1.5 -translate-x-1/2 rtl:translate-x-1/2 translate-y-1/2 rounded-full bg-pink-300 shadow-[0_0_10px_2px_rgb(249_168_212/0.6)]" />
        </span>
      </div>
      {GETA_STARS.map(([top, left, size, delay], i) => (
        <span
          key={i}
          className="auth-geta-star absolute rounded-full bg-white"
          style={{ top, left, width: size, height: size, animationDelay: delay }}
        />
      ))}
      <span className="absolute -bottom-[300px] -end-[300px] size-[760px] rounded-full border border-white/10" />
      <span className="absolute -bottom-[210px] -end-[210px] size-[580px] rounded-full border border-white/10" />
      <div className="absolute inset-x-0 bottom-0 h-28 overflow-hidden">
        <svg
          viewBox="0 0 1800 120"
          preserveAspectRatio="none"
          className="auth-geta-wave absolute bottom-0 start-0 h-full w-[200%] fill-white/[0.06]"
        >
          <path d={WAVE_A} />
        </svg>
        <svg
          viewBox="0 0 1800 120"
          preserveAspectRatio="none"
          className="auth-geta-wave auth-geta-wave--rev absolute bottom-0 start-0 h-[78%] w-[200%] fill-violet-400/[0.12]"
        >
          <path d={WAVE_B} />
        </svg>
      </div>
    </div>
  );
}

/** The three drifting amber/orange squares scattered over design 6's panel, Geta's own shapes. */
export function GetaShapes() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {GETA_SHAPES.map((shape, i) => (
        <span
          key={i}
          className={cn('absolute rounded-[4px] shadow-lg', shape.className)}
          style={shape.style}
        />
      ))}
    </div>
  );
}

/** Design 6's stat column (sign-in and sign-up only): three number/label rows stacked above the corner orb. */
export function GetaStats({ page, extra }: { page: AuthPageName; extra?: Record<string, string> }) {
  const copy = useShowcaseCopy(page, extra);
  if (page === 'forgot') return null;
  return (
    <div className="relative z-10 mt-8 space-y-3">
      {STAT_INDEXES.map((i) => (
        <div
          key={i}
          className="auth-geta-rise auth-geta-stat flex items-baseline justify-between border-t border-white/15 pt-3"
          style={{ ['--d' as string]: `${0.45 + i * 0.12}s` }}
        >
          <dt className="text-[22px] font-extrabold leading-none">{copy(`stat${i}_num`)}</dt>
          <dd className="text-[12px] text-white/70">{copy(`stat${i}_label`)}</dd>
        </div>
      ))}
    </div>
  );
}

const EYEBROW =
  'font-mono rtl:font-sans text-[10px] uppercase tracking-[0.18em] rtl:tracking-normal';

/** Small mono line above a heading. `on` picks the colour for the surface it sits on. */
export function Eyebrow({
  children,
  on = 'paper',
  className,
}: {
  children: ReactNode;
  on?: 'paper' | 'dark';
  className?: string;
}) {
  return (
    <p
      className={cn(
        EYEBROW,
        on === 'dark' ? 'text-(--auth-light)/70' : 'text-(--auth-ink-500)',
        className,
      )}
    >
      {children}
    </p>
  );
}
