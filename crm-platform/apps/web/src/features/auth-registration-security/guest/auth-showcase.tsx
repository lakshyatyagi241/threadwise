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

/** Media filling its panel, with the dark veil that keeps the text on top of it readable. */
export function MediaBackdrop({
  content,
  veil = 'bg-black/55',
}: {
  content: Pick<AuthPageContent, 'mediaUrl' | 'mediaType'>;
  veil?: string;
}) {
  if (!safeUrl(content.mediaUrl)) return null;
  return (
    <>
      <AuthMedia content={content} className="absolute inset-0 size-full object-cover" />
      <div aria-hidden="true" className={cn('absolute inset-0', veil)} />
    </>
  );
}

/** The two soft lights behind a dark panel. */
export function Blobs({ variant = 'pair' }: { variant?: 'pair' | 'corner' }) {
  if (variant === 'corner') {
    return (
      <div
        aria-hidden="true"
        className="auth-blob -end-10 -top-10 size-[280px] bg-(--auth-light)/30"
      />
    );
  }
  return (
    <>
      <div
        aria-hidden="true"
        className="auth-blob -start-12 -top-12 size-[300px] bg-(--auth-green)"
      />
      <div
        aria-hidden="true"
        className="auth-blob end-12 bottom-12 size-[260px] bg-(--auth-amber)"
      />
    </>
  );
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
      {accent ? (
        <span style={style} className="italic rtl:not-italic">
          {accent}
        </span>
      ) : null}
      {heading || accent ? '.' : null}
    </>
  );
}

/** The product mark: a speech-bubble tile and the name in the display type. */
export function BrandMark({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-md bg-(--auth-deep) text-(--auth-light)"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
          <path d="M5 3h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-7l-5 4v-4H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" />
        </svg>
      </span>
      <span className="font-serif text-[22px] tracking-[-0.01em]">{name}</span>
    </span>
  );
}

/** Design 6's wordmark: a round indigo "G" mark with a small tail dot, Geta's own brand, not the shared one. */
export function GetaMark({
  name,
  tone = 'light',
  className,
}: {
  name: string;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden="true"
        className="relative grid size-9 shrink-0 place-items-center rounded-full bg-(--auth-geta-primary)"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[18px]"
          fill="none"
          stroke="#fff"
          strokeWidth="2.6"
          strokeLinecap="round"
        >
          <path d="M17.6 8.3A6.6 6.6 0 1 0 18.6 13h-6.1" />
        </svg>
        <span className="absolute -bottom-px -right-px size-[5px] rounded-full bg-(--auth-geta-ink)" />
      </span>
      <span
        className={cn(
          'text-[21px] font-extrabold tracking-[-0.01em]',
          tone === 'dark' ? 'text-white' : 'text-foreground',
        )}
      >
        {name}
      </span>
    </span>
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
          <span className="absolute left-1/2 top-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-400 shadow-[0_0_12px_3px_rgb(167_139_250/0.7)]" />
        </span>
        <span className="auth-geta-orbit auth-geta-orbit--rev absolute -inset-[44px]">
          <span className="absolute bottom-0 left-1/2 size-1.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-pink-300 shadow-[0_0_10px_2px_rgb(249_168_212/0.6)]" />
        </span>
      </div>
      {GETA_STARS.map(([top, left, size, delay], i) => (
        <span
          key={i}
          className="auth-geta-star absolute rounded-full bg-white"
          style={{ top, left, width: size, height: size, animationDelay: delay }}
        />
      ))}
      <span className="absolute -bottom-[300px] -right-[300px] size-[760px] rounded-full border border-white/10" />
      <span className="absolute -bottom-[210px] -right-[210px] size-[580px] rounded-full border border-white/10" />
      <div className="absolute inset-x-0 bottom-0 h-28 overflow-hidden">
        <svg
          viewBox="0 0 1800 120"
          preserveAspectRatio="none"
          className="auth-geta-wave absolute bottom-0 left-0 h-full w-[200%] fill-white/[0.06]"
        >
          <path d={WAVE_A} />
        </svg>
        <svg
          viewBox="0 0 1800 120"
          preserveAspectRatio="none"
          className="auth-geta-wave auth-geta-wave--rev absolute bottom-0 left-0 h-[78%] w-[200%] fill-violet-400/[0.12]"
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

function Check() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3 shrink-0 text-(--auth-green)"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M3 8l3 3 7-7" />
    </svg>
  );
}

const CARD = 'rounded-2xl border border-(--auth-light)/15 bg-(--auth-light)/8 backdrop-blur-sm';

/** The hero card at the top of a showcase: icon tile, bold line, small line. */
export function HeroCard({
  title,
  description,
  icon = 1,
}: {
  title: string;
  description: string;
  icon?: number;
}) {
  if (!title && !description) return null;
  return (
    <div className={cn(CARD, 'mb-4 p-5')}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-(--auth-green)/25 text-(--auth-green)">
          <Glyph index={icon} />
        </span>
        <div>
          <p className="text-[14px] font-semibold leading-tight">{title}</p>
          <p className="mt-1 text-[12px] leading-snug text-(--auth-light)/75">{description}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * The dark marketing panel of design 1 (Split showcase): hero card, eyebrow, big heading with an accent word,
 * one paragraph, then (sign-in and sign-up only) three stat tiles, four feature cards and a checklist, and a
 * footer line at the bottom edge.
 */
export function ShowcasePanel({
  page,
  content,
  extra,
  footer,
}: {
  page: AuthPageName;
  content: AuthPageContent;
  extra?: Record<string, string>;
  /** Resolved footer line (the admin's text, or year, name and country). */
  footer: string;
}) {
  const copy = useShowcaseCopy(page, extra);
  const showDetails = page !== 'forgot';
  const chips = CHIP_INDEXES.map((i) => copy(`chip${i}`)).filter(Boolean);

  return (
    <>
      <div className="relative z-10 flex w-full flex-1 flex-col justify-center">
        <HeroCard title={copy('hero_title')} description={copy('hero_desc')} />

        {content.eyebrow && (
          <Eyebrow on="dark" className="mb-3">
            {content.eyebrow}
          </Eyebrow>
        )}
        <h1 className="font-serif text-[42px] leading-[1.05] tracking-[-0.01em]">
          <AccentHeading heading={content.heading} accent={content.headingAccent} tone="accent" />
        </h1>
        {content.subheading && (
          <p className="mt-3 text-[13px] leading-relaxed text-(--auth-light)/85">
            {content.subheading}
          </p>
        )}

        {showDetails && (
          <>
            <dl className="mt-5 grid grid-cols-3 gap-3">
              {STAT_INDEXES.map((i) => (
                <div key={i} className="auth-stat-pill rounded-2xl p-4 text-center">
                  <dt className="font-serif text-[24px] leading-none">{copy(`stat${i}_num`)}</dt>
                  <dd className="mt-1 text-[10.5px] text-(--auth-light)/70">
                    {copy(`stat${i}_label`)}
                  </dd>
                </div>
              ))}
            </dl>

            <ul className="mt-5 grid grid-cols-2 gap-3">
              {FEATURE_INDEXES.map((i) => (
                <li key={i} className={cn(CARD, 'p-4')}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="grid size-7 place-items-center rounded-lg bg-(--auth-green)/25 text-(--auth-green)">
                      <Glyph index={i - 1} className="size-3.5" />
                    </span>
                    <span className="text-[12.5px] font-semibold">{copy(`feat${i}_title`)}</span>
                  </div>
                  <p className="text-[11px] leading-snug text-(--auth-light)/70">
                    {copy(`feat${i}_desc`)}
                  </p>
                </li>
              ))}
            </ul>

            {chips.length > 0 && (
              <div className={cn(CARD, 'mt-4 p-4')}>
                <p className="mb-2 font-mono rtl:font-sans text-[10px] uppercase tracking-[0.16em] rtl:tracking-normal text-(--auth-light)/70">
                  {copy('inside_heading')}
                </p>
                <ul className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-[11.5px] text-(--auth-light)/85">
                  {chips.map((chip, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <Check />
                      <span>{chip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {footer && (
        <p className="relative z-10 mt-6 text-end font-mono rtl:font-sans text-[11px] text-(--auth-light)/60">
          {footer}
        </p>
      )}
    </>
  );
}
