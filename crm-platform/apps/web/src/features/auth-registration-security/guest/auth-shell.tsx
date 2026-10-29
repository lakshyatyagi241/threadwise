'use client';

import type { AuthPageContent, AuthPageName, AuthPageTextField } from '@crm/contracts';
import { cn } from '@crm/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { accentOnDark, normalizeAccent } from './accent';
import './auth.css';
import { AccentHeading, Eyebrow, GetaMark, GetaShapes, GetaSky, GetaStats } from './auth-showcase';
import { defaultFooter } from './footer-line';
import { withLocalisedDefaults } from './localised-content';

/** Copy above the form: a mono line, the title with an accent word, and one line of help. */
export interface ShellHeader {
  eyebrow?: string;
  title: string;
  accent?: string;
  subtitle?: string;
}

/**
 * The fixed left panel of pages that ignore the admin's design (reset password, the emailed-link landings):
 * a hero card, a mono line, a heading with an accent word and one paragraph.
 */
export interface FixedPanel {
  heroTitle: string;
  heroDesc: string;
  eyebrow: string;
  heading: string;
  accent: string;
  subheading: string;
}

export interface AuthShellProps {
  page: AuthPageName;
  /** Admin-editable copy, accent colour and optional media (`registration-config` `authPages.<page>`). */
  content: AuthPageContent;
  /**
   * Text fields the admin left empty (`registration-config` `authPages.defaulted.<page>`): the shell shows its
   * own localised copy for these instead of the English default the API sent. Omit to show `content` as given
   * (the editor preview does).
   */
  defaulted?: readonly AuthPageTextField[];
  /** Optional showcase copy for the split design (`registration-config` `authPages.extra.<page>`). */
  extra?: Record<string, string>;
  children: ReactNode;
  /** Editor preview: links and buttons do nothing, and the shell fills its container instead of the viewport. */
  preview?: boolean;
  /** Product name for the brand mark. Falls back to the generic name from the messages. */
  appName?: string;
  /** Default country (ISO 3166 alpha-2): its name closes the default footer line. */
  countryIso?: string | null;
  /**
   * Replaces the built-in form header (follow-up screens such as the one-time code). `null` draws none: the
   * content then brings its own (the setup steps, whose title depends on the step the visitor is on).
   */
  header?: ShellHeader | null;
  /** Shows the fixed split design with this panel, whatever the admin picked. */
  fixedPanel?: FixedPanel;
  /** Language and theme switches, owned by the caller (they need the router, which the preview does not have). */
  toolbar?: ReactNode;
}

/**
 * The guest-page design (the Geta split; the five other designs are gone). Props in, markup out: no
 * session, no router, no server-only imports, so the same component serves /login, /signup,
 * /forgot-password and the admin editor's live preview. The form is the same in every design;
 * only the chrome around it changes.
 */
export function AuthShell({
  page,
  content: given,
  defaulted,
  extra,
  children,
  preview = false,
  appName,
  countryIso,
  header,
  fixedPanel,
  toolbar,
}: AuthShellProps) {
  const t = useTranslations('auth-registration-security.guest.shell');
  const locale = useLocale();
  const content = withLocalisedDefaults(given, defaulted, (field) => {
    const path = `contentDefaults.${page}.${field}`;
    return t.has(path) ? t(path) : undefined;
  });
  const name = appName?.trim() || t('appNameFallback');
  const vars = {
    '--auth-accent': normalizeAccent(content.accent),
    '--auth-accent-dark': accentOnDark(content.accent),
  } as CSSProperties;
  const formHeader: ShellHeader | null =
    header === null
      ? null
      : (header ?? {
          eyebrow: t(`header.${page}.eyebrow`),
          title: t(`header.${page}.title`),
          accent: t(`header.${page}.accent`),
          subtitle: t(`header.${page}.subtitle`),
        });
  const footer = (extra?.footer ?? '').trim() || defaultFooter(name, countryIso, locale);
  const inert = preview
    ? {
        'data-preview': 'true',
        onClickCapture: (e: MouseEvent<HTMLElement>) => {
          if ((e.target as HTMLElement).closest('a,button[type="submit"]')) e.preventDefault();
        },
      }
    : {};

  // A page with a fixed panel (reset password, the emailed-link landings) says its own words on the dark side.
  const shown: AuthPageContent = fixedPanel
    ? {
        ...content,
        eyebrow: fixedPanel.eyebrow,
        heading: fixedPanel.heading,
        headingAccent: fixedPanel.accent,
        subheading: fixedPanel.subheading,
      }
    : content;

  const common: VariantProps = {
    page,
    content: shown,
    name,
    toolbar,
    formHeader,
    footer,
    children,
    preview,
  };

  return (
    <div
      style={vars}
      className={cn('auth-scope bg-muted text-foreground', preview && 'h-full')}
      {...inert}
    >
      <GetaSplit extra={extra} {...common} />
    </div>
  );
}

interface VariantProps {
  page: AuthPageName;
  content: AuthPageContent;
  name: string;
  toolbar?: ReactNode;
  formHeader: ShellHeader | null;
  footer: string;
  children: ReactNode;
  preview: boolean;
}

/** The title block the form always carries, in every design: mono line, serif title with accent word, help line. */
export function FormHeader({ header, page }: { header: ShellHeader | null; page: AuthPageName }) {
  if (!header) return null;
  return (
    <header className="mb-5">
      {header.eyebrow && <Eyebrow className="mb-2">{header.eyebrow}</Eyebrow>}
      <h2
        className={cn(
          'font-serif tracking-[-0.01em]',
          page === 'register' ? 'text-[30px]' : 'text-[34px]',
          // After the size: merging a font size drops an earlier line-height class.
          'leading-tight',
        )}
      >
        <AccentHeading heading={header.title} accent={header.accent} tone="deep" />
      </h2>
      {header.subtitle && (
        <p className="mt-2 text-[13px] text-(--auth-ink-600)">{header.subtitle}</p>
      )}
    </header>
  );
}

/**
 * On wide screens the form must never scroll: when its natural height is taller than the column (browser zoomed in,
 * short window) it is scaled down to fit, and it returns to full size as room appears. Narrow screens scroll as usual.
 */
function FitHeight({ children, className }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; height?: number }>({ scale: 1 });

  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    const column = box?.parentElement;
    if (!box || !content || !column) return;
    const measure = () => {
      if (!window.matchMedia('(min-width: 1024px)').matches) {
        setFit((f) => (f.scale === 1 && f.height === undefined ? f : { scale: 1 }));
        return;
      }
      const cs = getComputedStyle(column);
      // The card is capped at the window height minus the page's 1.5rem of padding; measure against that cap, not the column, so shrinking the form never shrinks the room.
      const room =
        window.innerHeight - 24 - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const natural = content.offsetHeight;
      if (natural <= 0 || room <= 0) return;
      const wide = column.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const growth = Math.min(1.08, wide / Math.max(box.offsetWidth, 1));
      const scale = Math.max(0.4, Math.min(growth, room / natural));
      setFit((f) =>
        Math.abs(f.scale - scale) < 0.005
          ? f
          : { scale, height: scale !== 1 ? natural * scale : undefined },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(column);
    ro.observe(content);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div
      ref={outer}
      className={className}
      style={
        fit.height === undefined
          ? undefined
          : { height: fit.height, overflow: fit.scale < 1 ? 'hidden' : 'visible' }
      }
    >
      <div
        ref={inner}
        style={
          fit.scale !== 1
            ? { transform: `scale(${fit.scale})`, transformOrigin: 'top center' }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Design 6: Geta's own look, not the shared brand palette the other five designs use — a centered
 * white/indigo split card floating on a soft lavender canvas, with Geta's wordmark, colours, dotted
 * panel texture and drifting amber shapes.
 */
function GetaSplit({
  page,
  extra,
  content,
  name,
  toolbar,
  formHeader,
  footer,
  children,
  preview,
}: VariantProps & { extra?: Record<string, string> }) {
  return (
    <div
      className={cn(
        'auth-geta-page relative flex items-center justify-center overflow-hidden px-4 py-3',
        preview ? 'min-h-full' : 'min-h-dvh lg:h-dvh',
      )}
    >
      <span
        aria-hidden="true"
        className="auth-geta-blob auth-geta-blob--slow -start-40 -top-40 size-[500px] bg-violet-300/30 blur-[120px]"
      />
      <span
        aria-hidden="true"
        className="auth-geta-blob -bottom-40 -end-40 size-[500px] bg-indigo-300/30 blur-[120px]"
      />
      <div className="auth-geta-card relative flex w-full max-w-7xl overflow-hidden rounded-3xl shadow-2xl lg:max-h-[calc(100dvh-1.5rem)] lg:min-h-[min(720px,calc(100dvh-1.5rem))]">
        <main
          className={cn(
            'relative flex w-full flex-col bg-background px-6 py-4 sm:w-1/2 sm:px-10 lg:overflow-hidden lg:px-12 lg:py-5',
          )}
        >
          {/* `my-auto` centres the form when there is room and lets the column scroll from the top when there is not (zoomed in). */}
          <FitHeight
            className={cn(
              '@container mx-auto my-auto w-full',
              // Sign-up has the most fields: wide enough for two columns. The other pages stay narrow so the form can grow to fill the card.
              page === 'register' ? 'max-w-[380px] xl:max-w-[548px]' : 'max-w-[420px]',
            )}
          >
            <div className="relative z-30 mb-4 flex items-center justify-between gap-3">
              <GetaMark name={name} />
              {toolbar}
            </div>
            <FormHeader header={formHeader} page={page} />
            {children}
          </FitHeight>
        </main>
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-(--auth-geta-ink) p-12 text-white sm:flex sm:w-1/2">
          <span aria-hidden="true" className="auth-geta-dots" />
          <span
            aria-hidden="true"
            className="auth-geta-blob start-1/2 top-1/3 size-80 bg-(--auth-geta-primary)/15 blur-[80px]"
          />
          <span
            aria-hidden="true"
            className="auth-geta-blob auth-geta-blob--rev -end-24 top-1/4 size-80 bg-(--auth-geta-primary)/30 blur-[80px]"
          />
          <span aria-hidden="true" className="auth-geta-sheen" />
          <span
            aria-hidden="true"
            className="auth-geta-orb auth-geta-orb--pulse -bottom-16 -end-16 size-72"
          />
          <GetaSky />
          <GetaShapes />
          <div className="relative z-10 my-auto max-w-[420px]">
            {content.eyebrow && (
              <Eyebrow on="dark" className="auth-geta-rise mb-4">
                {content.eyebrow}
              </Eyebrow>
            )}
            <h1
              className="auth-geta-rise text-[clamp(28px,4vw,42px)] font-extrabold leading-[1.1] tracking-[-0.01em]"
              style={{ ['--d' as string]: '0.15s' }}
            >
              {content.heading} {content.headingAccent}
            </h1>
            {content.subheading && (
              <p
                className="auth-geta-rise mt-4 text-[14px] leading-relaxed text-white/75"
                style={{ ['--d' as string]: '0.3s' }}
              >
                {content.subheading}
              </p>
            )}
            <GetaStats page={page} extra={extra} />
          </div>
          <p className="relative z-10 mt-6 text-[11px] text-white/50">{footer}</p>
        </aside>
      </div>
    </div>
  );
}
