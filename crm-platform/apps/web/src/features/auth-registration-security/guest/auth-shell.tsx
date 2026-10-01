'use client';

import type { AuthPageContent, AuthPageName, AuthPageTextField } from '@crm/contracts';
import { cn } from '@crm/ui';
import { useTranslations } from 'next-intl';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { normalizeAccent, readableOn } from './accent';
import { AccentHeading, AuthMedia, BrandMark, ShowcasePanel } from './auth-showcase';
import { withLocalisedDefaults } from './localised-content';
import { safeUrl } from './safe-url';

export type AuthVariant = 1 | 2 | 3 | 4 | 5;

/** Copy above the form on the split designs, or replacing the editable heading on the centred ones. */
export interface ShellHeader {
  eyebrow?: string;
  title: string;
  accent?: string;
  subtitle?: string;
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
  /** Replaces the built-in form header (follow-up screens such as the one-time code). */
  header?: ShellHeader;
  /** Language and theme switches, owned by the caller (they need the router, which the preview does not have). */
  toolbar?: ReactNode;
}

function clampVariant(value: number): AuthVariant {
  return value >= 1 && value <= 5 ? (Math.trunc(value) as AuthVariant) : 1;
}

/**
 * The five guest-page designs (TW-AUTH-021). Props in, markup out: no session, no router, no
 * server-only imports, so the same component serves /login, /signup, /forgot-password and the
 * admin editor's live preview.
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
  header,
  toolbar,
}: AuthShellProps) {
  const t = useTranslations('auth-registration-security.guest.shell');
  const content = withLocalisedDefaults(given, defaulted, (field) => {
    const path = `contentDefaults.${page}.${field}`;
    return t.has(path) ? t(path) : undefined;
  });
  const accent = normalizeAccent(content.accent);
  const name = appName?.trim() || t('appNameFallback');
  const v = clampVariant(variant);
  const vars = { '--auth-accent': accent, '--auth-ink': readableOn(accent) } as CSSProperties;
  const formHeader: ShellHeader = header ?? {
    eyebrow: t(`header.${page}.eyebrow`),
    title: t(`header.${page}.title`),
    accent: t(`header.${page}.accent`),
    subtitle: t(`header.${page}.subtitle`),
  };
  const footer =
    (extra?.footer ?? '').trim() ||
    (t.has(`defaults.${page}.footer`) ? t(`defaults.${page}.footer`) : '');
  const frame = preview ? 'min-h-full' : 'min-h-dvh';
  const inert = preview
    ? {
        'data-preview': 'true',
        onClickCapture: (e: MouseEvent<HTMLElement>) => {
          if ((e.target as HTMLElement).closest('a,button[type="submit"]')) e.preventDefault();
        },
      }
    : {};

  const common = { content, name, toolbar, formHeader, footer, children, frame };

  return (
    <div style={vars} className={cn('text-foreground', preview && 'h-full')} {...inert}>
      {v === 1 && <SplitShowcase page={page} extra={extra} {...common} />}
      {v === 2 && <Cinematic page={page} replaceHeading={Boolean(header)} {...common} />}
      {v === 3 && <Minimal page={page} replaceHeading={Boolean(header)} {...common} />}
      {v === 4 && <Spotlight page={page} {...common} />}
      {v === 5 && <Aurora page={page} replaceHeading={Boolean(header)} {...common} />}
    </div>
  );
}

interface VariantProps {
  page: AuthPageName;
  content: AuthPageContent;
  name: string;
  toolbar?: ReactNode;
  formHeader: ShellHeader;
  footer: string;
  children: ReactNode;
  frame: string;
}

/** Eyebrow, title with an accent word and one line of help, above the form on split designs. */
function FormHeader({ header }: { header: ShellHeader }) {
  return (
    <header className="mb-6 space-y-2">
      {header.eyebrow && (
        <p className="font-mono rtl:font-sans text-[11px] uppercase tracking-[0.18em] rtl:tracking-normal text-muted-foreground">
          {header.eyebrow}
        </p>
      )}
      <h1 className="font-serif text-3xl leading-tight tracking-tight">
        <AccentHeading heading={header.title} accent={header.accent} tone="on-light" />
      </h1>
      {header.subtitle && <p className="text-sm text-muted-foreground">{header.subtitle}</p>}
    </header>
  );
}

/** The admin-edited heading block shown above the form on the centred designs. */
function CenteredHeader({
  content,
  header,
  replaceHeading,
  align = 'center',
  tone = 'on-light',
}: {
  content: AuthPageContent;
  header: ShellHeader;
  replaceHeading: boolean;
  align?: 'center' | 'start';
  tone?: 'on-light' | 'on-dark';
}) {
  const text = align === 'center' ? 'text-center' : 'text-start';
  const muted = tone === 'on-dark' ? 'text-white/75' : 'text-muted-foreground';
  const eyebrow = replaceHeading ? header.eyebrow : content.eyebrow;
  const subtitle = replaceHeading ? header.subtitle : content.subheading;
  return (
    <header className={cn('mb-6 space-y-2', text)}>
      {eyebrow && (
        <p
          className={cn(
            'font-mono rtl:font-sans text-[11px] uppercase tracking-[0.18em] rtl:tracking-normal',
            muted,
          )}
        >
          {eyebrow}
        </p>
      )}
      <h1 className="font-serif text-3xl leading-tight tracking-tight">
        {replaceHeading ? (
          <AccentHeading heading={header.title} accent={header.accent} tone={tone} />
        ) : (
          <AccentHeading heading={content.heading} accent={content.headingAccent} tone={tone} />
        )}
      </h1>
      {subtitle && <p className={cn('text-sm', muted)}>{subtitle}</p>}
    </header>
  );
}

function Footnote({ footer }: { footer: string }) {
  return footer ? <p className="mt-6 text-center text-xs text-muted-foreground">{footer}</p> : null;
}

/** Design 1: dark marketing panel on one side, the form on the other. */
function SplitShowcase({
  page,
  extra,
  content,
  name,
  toolbar,
  formHeader,
  children,
  frame,
}: VariantProps & { extra?: Record<string, string> }) {
  return (
    <div className={cn('grid lg:grid-cols-[1.05fr_1fr]', frame)}>
      <aside
        className="relative hidden overflow-hidden text-white lg:block"
        style={{
          background:
            'radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--auth-accent) 85%, #000) 0%, transparent 60%), radial-gradient(90% 70% at 100% 100%, color-mix(in srgb, var(--auth-accent) 35%, #f59e0b) 0%, transparent 55%), #04100e',
        }}
      >
        {safeUrl(content.mediaUrl) && (
          <>
            <AuthMedia content={content} className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-black/60" />
          </>
        )}
        <ShowcasePanel page={page} content={content} extra={extra} appName={name} />
      </aside>
      <main className="flex flex-col bg-background px-4 py-4 sm:px-10">
        <div className="flex justify-end">{toolbar}</div>
        <div className="m-auto w-full max-w-md py-8">
          <div className="mb-8 lg:hidden">
            <BrandMark name={name} tone="on-light" />
          </div>
          <FormHeader header={formHeader} />
          {children}
        </div>
      </main>
    </div>
  );
}

/** Design 2: full-bleed media (or a gradient) behind a centred card. */
function Cinematic({
  content,
  name,
  toolbar,
  formHeader,
  footer,
  children,
  frame,
  replaceHeading,
}: VariantProps & { replaceHeading: boolean }) {
  return (
    <div className={cn('relative isolate flex flex-col', frame)}>
      <div
        className="absolute inset-0 -z-10 overflow-hidden"
        style={{
          background:
            'radial-gradient(90% 70% at 20% 10%, color-mix(in srgb, var(--auth-accent) 80%, #000) 0%, transparent 60%), #050b0a',
        }}
      >
        {safeUrl(content.mediaUrl) && (
          <AuthMedia content={content} className="absolute inset-0 size-full object-cover" />
        )}
        <div className="absolute inset-0 bg-black/55" />
      </div>
      <header className="flex items-center justify-between gap-3 p-4 text-white sm:px-8">
        <BrandMark name={name} tone="on-dark" />
        {toolbar}
      </header>
      <main className="m-auto w-full max-w-md px-4 pb-10">
        <div className="rounded-2xl border border-white/15 bg-background/92 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
          <CenteredHeader content={content} header={formHeader} replaceHeading={replaceHeading} />
          {children}
        </div>
        <Footnote footer={footer} />
      </main>
    </div>
  );
}

/** Design 3: a plain card on a quiet background. */
function Minimal({
  content,
  name,
  toolbar,
  formHeader,
  footer,
  children,
  frame,
  replaceHeading,
}: VariantProps & { replaceHeading: boolean }) {
  return (
    <div className={cn('flex flex-col bg-muted', frame)}>
      <header className="flex items-center justify-between gap-3 p-4 sm:px-8">
        <BrandMark name={name} tone="on-light" />
        {toolbar}
      </header>
      <main className="m-auto w-full max-w-md px-4 pb-10">
        <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
          <div className="h-1" style={{ background: 'var(--auth-accent)' }} />
          <div className="p-6 sm:p-8">
            <CenteredHeader content={content} header={formHeader} replaceHeading={replaceHeading} />
            {children}
          </div>
        </div>
        <Footnote footer={footer} />
      </main>
    </div>
  );
}

/** Design 4: a solid brand-colour panel carries the message, the form sits on plain background. */
function Spotlight({ content, name, toolbar, formHeader, footer, children, frame }: VariantProps) {
  return (
    <div className={cn('grid lg:grid-cols-[5fr_7fr]', frame)}>
      <aside
        className="relative hidden flex-col justify-between gap-8 overflow-hidden p-10 lg:flex xl:p-12"
        style={{ background: 'var(--auth-accent)', color: 'var(--auth-ink)' }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -end-24 -top-24 size-72 rounded-full opacity-20"
          style={{ background: 'var(--auth-ink)' }}
        />
        <BrandMark name={name} tone="on-accent" />
        <div className="relative space-y-4">
          {content.eyebrow && (
            <p className="font-mono rtl:font-sans text-[11px] uppercase tracking-[0.18em] rtl:tracking-normal opacity-75">
              {content.eyebrow}
            </p>
          )}
          <p className="font-serif text-4xl leading-[1.1] tracking-tight xl:text-5xl">
            <AccentHeading
              heading={content.heading}
              accent={content.headingAccent}
              tone="on-accent"
            />
          </p>
          {content.subheading && (
            <p className="max-w-sm text-sm leading-relaxed opacity-85">{content.subheading}</p>
          )}
          {safeUrl(content.mediaUrl) && (
            <AuthMedia
              content={content}
              className="mt-4 aspect-video w-full rounded-2xl object-cover shadow-lg"
            />
          )}
        </div>
        <p className="relative text-xs opacity-75">{footer}</p>
      </aside>
      <main className="flex flex-col bg-background px-4 py-4 sm:px-10">
        <div className="flex items-center justify-between gap-3">
          <span className="lg:hidden">
            <BrandMark name={name} tone="on-light" />
          </span>
          <span className="ms-auto">{toolbar}</span>
        </div>
        <div className="m-auto w-full max-w-md py-8">
          <FormHeader header={formHeader} />
          {children}
        </div>
      </main>
    </div>
  );
}

/** Design 5: soft gradient light behind a glass card. */
function Aurora({
  content,
  name,
  toolbar,
  formHeader,
  footer,
  children,
  frame,
  replaceHeading,
}: VariantProps & { replaceHeading: boolean }) {
  return (
    <div className={cn('relative isolate flex flex-col overflow-hidden bg-background', frame)}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute -start-1/4 -top-1/3 size-[46rem] rounded-full opacity-45 blur-3xl"
          style={{ background: 'var(--auth-accent)' }}
        />
        <div
          className="absolute -end-1/4 top-1/4 size-[40rem] rounded-full opacity-35 blur-3xl"
          style={{ background: 'color-mix(in srgb, var(--auth-accent) 45%, #6366f1)' }}
        />
        <div
          className="absolute -bottom-1/3 start-1/4 size-[36rem] rounded-full opacity-30 blur-3xl"
          style={{ background: 'color-mix(in srgb, var(--auth-accent) 40%, #f59e0b)' }}
        />
      </div>
      <header className="flex items-center justify-between gap-3 p-4 sm:px-8">
        <BrandMark name={name} tone="on-light" />
        {toolbar}
      </header>
      <main className="m-auto w-full max-w-md px-4 pb-10">
        <CenteredHeader content={content} header={formHeader} replaceHeading={replaceHeading} />
        <div className="rounded-2xl border border-border/60 bg-background/75 p-6 shadow-xl backdrop-blur-xl sm:p-8">
          {children}
        </div>
        <Footnote footer={footer} />
      </main>
    </div>
  );
}
