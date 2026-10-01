'use client';

import type { AuthPageContent, AuthPageName } from '@crm/contracts';
import { useTranslations } from 'next-intl';
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

/** "heading <accent word>": the accent word picks up the brand colour. */
export function AccentHeading({
  heading,
  accent,
  tone,
  italic = true,
}: {
  heading?: string;
  accent?: string;
  tone: 'on-dark' | 'on-light' | 'on-accent';
  italic?: boolean;
}) {
  const color =
    tone === 'on-dark'
      ? 'color-mix(in srgb, var(--auth-accent) 45%, #ffffff)'
      : tone === 'on-accent'
        ? 'inherit'
        : 'color-mix(in srgb, var(--auth-accent) 82%, var(--foreground))';
  return (
    <>
      {heading}
      {heading && accent ? ' ' : null}
      {accent ? (
        <span
          style={{ color }}
          className={
            tone === 'on-accent'
              ? 'underline decoration-2 underline-offset-4'
              : italic
                ? 'italic rtl:not-italic'
                : ''
          }
        >
          {accent}
        </span>
      ) : null}
    </>
  );
}

export function BrandMark({
  name,
  tone,
}: {
  name: string;
  tone: 'on-dark' | 'on-light' | 'on-accent';
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-8 items-center justify-center rounded-lg text-sm font-bold"
        style={
          tone === 'on-light'
            ? { background: 'var(--auth-accent)', color: 'var(--auth-ink)' }
            : { background: 'rgba(255,255,255,0.16)', color: 'currentColor' }
        }
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="text-sm font-semibold tracking-tight">{name}</span>
    </span>
  );
}

/** The dark marketing panel of design 1 (Split showcase). */
export function ShowcasePanel({
  page,
  content,
  extra,
  appName,
}: {
  page: AuthPageName;
  content: AuthPageContent;
  extra?: Record<string, string>;
  appName: string;
}) {
  const copy = useShowcaseCopy(page, extra);
  const showDetails = page !== 'forgot';
  const chips = CHIP_INDEXES.map((i) => copy(`chip${i}`)).filter(Boolean);

  return (
    <div className="relative z-10 flex h-full min-h-0 flex-col gap-6 p-10 xl:p-12">
      <BrandMark name={appName} tone="on-dark" />

      <div className="my-auto space-y-6">
        {(copy('hero_title') || copy('hero_desc')) && (
          <div className="flex items-start gap-3 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <Glyph index={1} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{copy('hero_title')}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-white/75">{copy('hero_desc')}</p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {content.eyebrow && (
            <p className="font-mono rtl:font-sans text-[11px] uppercase tracking-[0.18em] rtl:tracking-normal text-white/65">
              {content.eyebrow}
            </p>
          )}
          <p className="font-serif text-4xl leading-[1.1] tracking-tight xl:text-5xl">
            <AccentHeading
              heading={content.heading}
              accent={content.headingAccent}
              tone="on-dark"
            />
          </p>
          {content.subheading && (
            <p className="max-w-md text-sm leading-relaxed text-white/75">{content.subheading}</p>
          )}
        </div>

        {showDetails && (
          <>
            <dl className="grid grid-cols-3 gap-3">
              {STAT_INDEXES.map((i) => (
                <div
                  key={i}
                  className="rounded-xl border border-white/10 bg-black/20 p-3 text-center backdrop-blur-sm"
                >
                  <dt className="font-serif text-xl leading-none xl:text-2xl">
                    {copy(`stat${i}_num`)}
                  </dt>
                  <dd className="mt-1.5 text-[11px] leading-tight text-white/65">
                    {copy(`stat${i}_label`)}
                  </dd>
                </div>
              ))}
            </dl>

            <ul className="grid grid-cols-2 gap-3">
              {FEATURE_INDEXES.map((i) => (
                <li
                  key={i}
                  className="rounded-xl border border-white/12 bg-white/8 p-3.5 backdrop-blur-sm"
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="flex size-6 items-center justify-center rounded-md bg-white/15">
                      <Glyph index={i - 1} className="size-3.5" />
                    </span>
                    {copy(`feat${i}_title`)}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-white/70">
                    {copy(`feat${i}_desc`)}
                  </p>
                </li>
              ))}
            </ul>

            {chips.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.16em] rtl:tracking-normal text-white/55">
                  {copy('inside_heading')}
                </p>
                <ul className="flex flex-wrap gap-2">
                  {chips.map((chip, i) => (
                    <li
                      key={i}
                      className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/85"
                    >
                      {chip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {copy('footer') && <p className="text-xs text-white/60">{copy('footer')}</p>}
    </div>
  );
}
