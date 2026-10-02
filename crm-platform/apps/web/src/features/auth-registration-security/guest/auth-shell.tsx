'use client';

import type { AuthPageContent, AuthPageName, AuthPageTextField } from '@crm/contracts';
import { cn } from '@crm/ui';
import { useLocale, useTranslations } from 'next-intl';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { accentOnDark, normalizeAccent } from './accent';
import './auth.css';
import {
  AccentHeading,
  Blobs,
  BrandMark,
  Eyebrow,
  HeroCard,
  MediaBackdrop,
  ShowcasePanel,
} from './auth-showcase';
import { defaultFooter } from './footer-line';
import { withLocalisedDefaults } from './localised-content';

export type AuthVariant = 1 | 2 | 3 | 4 | 5;

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
  /** 1 Split showcase, 2 Cinematic, 3 Minimal, 4 Brand spotlight, 5 Aurora. Anything else renders as 1. */
  variant: AuthVariant | number;
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

function clampVariant(value: number): AuthVariant {
  return value >= 1 && value <= 5 ? (Math.trunc(value) as AuthVariant) : 1;
}

/**
 * The five guest-page designs (TW-AUTH-021). Props in, markup out: no session, no router, no
 * server-only imports, so the same component serves /login, /signup, /forgot-password and the
 * admin editor's live preview. The form is the same in every design; only the chrome around it changes.
 */
export function AuthShell({
  variant,
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
  const v = clampVariant(variant);
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

  const common: VariantProps = {
    page,
    content,
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
      {fixedPanel ? (
        <FixedSplit panel={fixedPanel} {...common} />
      ) : (
        <>
          {v === 1 && <SplitShowcase extra={extra} {...common} />}
          {v === 2 && <Cinematic {...common} />}
          {v === 3 && <Minimal {...common} />}
          {v === 4 && <Spotlight {...common} />}
          {v === 5 && <Aurora {...common} />}
        </>
      )}
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

/** Where the language and theme switches sit: the top corner of whatever surface the design has. */
function ToolbarCorner({
  toolbar,
  tone = 'paper',
}: {
  toolbar?: ReactNode;
  tone?: 'paper' | 'dark';
}) {
  if (!toolbar) return null;
  return (
    <div
      className={cn(
        'absolute end-3 top-3 z-20 sm:end-4 sm:top-4',
        tone === 'dark' && 'text-(--auth-light)',
      )}
    >
      {toolbar}
    </div>
  );
}

const MAIN_SCROLL = 'lg:overflow-y-auto';

/** Design 1: dark showcase on the left, the form on a 540 px column on the right. */
function SplitShowcase({
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
        'grid lg:grid-cols-[1fr_540px]',
        preview ? 'min-h-full' : 'min-h-dvh lg:h-dvh lg:overflow-hidden',
      )}
    >
      <aside className="auth-art relative hidden flex-col overflow-hidden p-10 text-(--auth-light) lg:flex">
        <Blobs />
        <MediaBackdrop content={content} />
        <ShowcasePanel page={page} content={content} extra={extra} footer={footer} />
      </aside>
      <FormColumn page={page} name={name} toolbar={toolbar} header={formHeader}>
        {children}
      </FormColumn>
    </div>
  );
}

/** The right-hand column of the split designs: brand (small screens), title block, form. */
function FormColumn({
  page,
  name,
  toolbar,
  header,
  children,
  surface = false,
  wide = false,
}: {
  page: AuthPageName;
  name: string;
  toolbar?: ReactNode;
  header: ShellHeader | null;
  children: ReactNode;
  /** Paper-coloured column (design 4) instead of the page colour. */
  surface?: boolean;
  wide?: boolean;
}) {
  const roomy = page !== 'register';
  return (
    <main
      className={cn(
        'relative flex flex-col px-6',
        MAIN_SCROLL,
        // Small screens keep the first rows clear for the language and theme switches in the corner.
        roomy ? 'pb-10 pt-16 lg:px-14 lg:py-10' : 'pb-6 pt-16 lg:px-10 lg:py-6',
        wide && 'lg:px-16',
        surface && 'bg-background',
      )}
    >
      <ToolbarCorner toolbar={toolbar} />
      {/* `my-auto` centres the form when there is room and lets the column scroll from the top when there is not. */}
      <div className="mx-auto my-auto w-full max-w-[400px]">
        <div className={cn('lg:hidden', roomy ? 'mb-8' : 'mb-6')}>
          <BrandMark name={name} />
        </div>
        <FormHeader header={header} page={page} />
        {children}
      </div>
    </main>
  );
}

/** The fixed split design (reset password and the emailed-link landings): the same layout, a panel of its own. */
function FixedSplit({
  panel,
  page,
  name,
  toolbar,
  formHeader,
  footer,
  children,
  preview,
}: VariantProps & { panel: FixedPanel }) {
  return (
    <div
      className={cn(
        'grid lg:grid-cols-[1fr_540px]',
        preview ? 'min-h-full' : 'min-h-dvh lg:h-dvh lg:overflow-hidden',
      )}
    >
      <aside className="auth-art relative hidden flex-col overflow-hidden p-10 text-(--auth-light) lg:flex">
        <Blobs />
        <div className="relative z-10 flex w-full flex-1 flex-col justify-center">
          <HeroCard title={panel.heroTitle} description={panel.heroDesc} icon={3} />
          <Eyebrow on="dark" className="mb-3">
            {panel.eyebrow}
          </Eyebrow>
          <h1 className="font-serif text-[42px] leading-[1.05] tracking-[-0.01em]">
            {panel.heading}{' '}
            <span className="italic rtl:not-italic text-(--auth-green)">{panel.accent}</span>.
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-(--auth-light)/85">
            {panel.subheading}
          </p>
        </div>
        <p className="relative z-10 mt-6 text-end font-mono rtl:font-sans text-[11px] text-(--auth-light)/60">
          {footer}
        </p>
      </aside>
      <FormColumn page={page} name={name} toolbar={toolbar} header={formHeader}>
        {children}
      </FormColumn>
    </div>
  );
}

const CARD_PAD = 'p-7 sm:p-9';

/** Design 2: full-bleed art behind a centred card; the heading sits above the card, on the art. */
function Cinematic({ content, name, toolbar, formHeader, page, children, preview }: VariantProps) {
  return (
    <div
      className={cn(
        'auth-art relative flex items-center justify-center overflow-hidden px-4 pb-4 pt-16 sm:p-8',
        preview ? 'min-h-full' : 'min-h-dvh',
      )}
    >
      <MediaBackdrop content={content} />
      <Blobs />
      <ToolbarCorner toolbar={toolbar} tone="dark" />
      <main className="relative z-10 w-full max-w-[440px]">
        <div className="mb-5 text-center text-(--auth-light)">
          <div className="inline-flex">
            <BrandMark name={name} />
          </div>
          {content.eyebrow && (
            <Eyebrow on="dark" className="mt-4">
              {content.eyebrow}
            </Eyebrow>
          )}
          <h1 className="mt-1 font-serif text-[30px] leading-tight">
            <AccentHeading heading={content.heading} accent={content.headingAccent} tone="accent" />
          </h1>
        </div>
        <div
          className={cn(
            'rounded-3xl border border-(--auth-paper-200)/60 bg-background shadow-2xl',
            CARD_PAD,
          )}
        >
          <FormHeader header={formHeader} page={page} />
          {children}
        </div>
      </main>
    </div>
  );
}

/** Design 3: a plain card on a quiet background with an accent bar on top; the one-line pitch sits under it. */
function Minimal({ content, name, toolbar, formHeader, page, children, preview }: VariantProps) {
  return (
    <div
      className={cn(
        'relative flex items-center justify-center bg-muted px-4 pb-4 pt-16 sm:p-6',
        preview ? 'min-h-full' : 'min-h-dvh',
      )}
    >
      <ToolbarCorner toolbar={toolbar} />
      <main className="w-full max-w-[440px]">
        <div className="overflow-hidden rounded-3xl border border-border bg-background shadow-(--auth-shadow-card)">
          <div className="h-1.5" style={{ background: 'var(--auth-accent)' }} />
          <div className={CARD_PAD}>
            <div className="mb-5 flex justify-center">
              <BrandMark name={name} />
            </div>
            <FormHeader header={formHeader} page={page} />
            {children}
          </div>
        </div>
        {content.subheading && (
          <p className="mx-auto mt-4 max-w-[360px] text-center text-[11.5px] leading-relaxed text-(--auth-ink-500)">
            {content.subheading}
          </p>
        )}
      </main>
    </div>
  );
}

/** Design 4: an accent-to-near-black gradient panel carries the message, the form sits on plain paper. */
function Spotlight({ content, name, toolbar, formHeader, page, children, preview }: VariantProps) {
  return (
    <div className={cn('grid lg:grid-cols-2', preview ? 'min-h-full' : 'min-h-dvh')}>
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-12 text-(--auth-light) lg:flex"
        style={{ background: 'linear-gradient(150deg, var(--auth-accent) 0%, #0b1f1c 95%)' }}
      >
        <MediaBackdrop content={content} veil="bg-black/45" />
        <Blobs variant="corner" />
        <div className="relative z-10">
          <BrandMark name={name} />
        </div>
        <div className="relative z-10">
          {content.eyebrow && (
            <Eyebrow on="dark" className="mb-4 tracking-[0.2em]">
              {content.eyebrow}
            </Eyebrow>
          )}
          <h1 className="font-serif text-[46px] leading-[1.04] tracking-[-0.01em]">
            <AccentHeading heading={content.heading} accent={content.headingAccent} tone="soft" />
          </h1>
          {content.subheading && (
            <p className="mt-4 max-w-[440px] text-[14px] leading-relaxed text-(--auth-light)/85">
              {content.subheading}
            </p>
          )}
        </div>
        <p className="relative z-10 font-mono rtl:font-sans text-[11px] text-(--auth-light)/60">
          © {new Date().getFullYear()} {name}
        </p>
      </aside>
      <FormColumn page={page} name={name} toolbar={toolbar} header={formHeader} surface wide>
        {children}
      </FormColumn>
    </div>
  );
}

/** Design 5: a slowly moving gradient mesh with a frosted card; only the brand and eyebrow sit above it. */
function Aurora({ content, name, toolbar, formHeader, page, children, preview }: VariantProps) {
  return (
    <div
      className={cn(
        'auth-aurora relative flex items-center justify-center overflow-hidden px-4 pb-4 pt-16 sm:p-6',
        preview ? 'min-h-full' : 'min-h-dvh',
      )}
    >
      <ToolbarCorner toolbar={toolbar} />
      <main className="relative z-10 w-full max-w-[430px]">
        <div className="mb-5 text-center">
          <div className="inline-flex">
            <BrandMark name={name} />
          </div>
          {content.eyebrow && <Eyebrow className="mt-4">{content.eyebrow}</Eyebrow>}
        </div>
        <div
          className={cn(
            'rounded-3xl border border-(--auth-paper-0)/60 bg-background/80 shadow-2xl ring-1 ring-(--auth-paper-200)/50 backdrop-blur-xl',
            CARD_PAD,
          )}
        >
          <FormHeader header={formHeader} page={page} />
          {children}
        </div>
      </main>
    </div>
  );
}
