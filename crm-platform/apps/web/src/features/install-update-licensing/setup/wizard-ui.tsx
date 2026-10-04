'use client';

import type { ComponentProps, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Spinner, cn } from '@crm/ui';
import type { Problem } from './setup-draft';

/**
 * Shared pieces of the install wizard, built from @crm/ui tokens and components so the screens read like WaDesk's
 * installer (mono eyebrow labels, serif headings with one italic accent word, pill buttons, rounded cards).
 */

export const NS = 'install-update-licensing.setup';

export const labelClass =
  'font-mono text-[10px] uppercase tracking-[0.14em] rtl:font-sans rtl:tracking-normal text-muted-foreground';
export const cardClass = 'space-y-3 rounded-2xl border border-border bg-background p-4 shadow-sm';
export const panelClass = 'rounded-2xl border border-border bg-muted p-3.5';
export const tileClass =
  'flex items-center justify-between rounded-lg border border-border bg-background py-1 ps-2.5 pe-2';

/** Rich-text renderers for the `<i>` accent word and `<b>` emphasis used in the copy. */
export const richTags = {
  i: (chunks: ReactNode) => <span className="italic text-brand">{chunks}</span>,
  b: (chunks: ReactNode) => <span className="font-medium text-foreground">{chunks}</span>,
};

export function Arrow({ dir = 'right' }: { dir?: 'right' | 'left' }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 rtl:-scale-x-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d={dir === 'right' ? 'M3 8h10M9 4l4 4-4 4' : 'M13 8H3M7 4L3 8l4 4'}
      />
    </svg>
  );
}

export function Tick({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn('size-3.5 shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l3 3 7-8" />
    </svg>
  );
}

export function Cross({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn('size-3.5 shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

/** Eyebrow, serif title with an italic accent (`<i>` in the message) and one line of help. */
export function StepHeader({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string;
  title: ReactNode;
  intro?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand rtl:font-sans rtl:tracking-normal">
        {eyebrow}
      </div>
      <h1 className="font-serif text-[24px] leading-tight tracking-[-0.01em]">{title}</h1>
      {intro && <p className="text-[12px] text-muted-foreground">{intro}</p>}
    </div>
  );
}

/** A coral box with one message, or a bullet list when there are several (WaDesk lists all on the long forms). */
export function ProblemBox({ problems }: { problems: Problem[] }) {
  const t = useTranslations(`${NS}.errors`);
  if (problems.length === 0) return null;
  const text = (p: Problem) => t(p.key, p.params);
  return (
    <Alert
      tone="danger"
      className="rounded-2xl px-4 py-2.5 text-[12.5px] font-medium"
      data-testid="setup-problems"
    >
      {problems.length === 1 ? (
        text(problems[0]!)
      ) : (
        <ul className="list-disc space-y-0.5 ps-5">
          {problems.map((p, i) => (
            <li key={`${p.key}-${i}`}>{text(p)}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

export function FailureBox({ children }: { children: ReactNode }) {
  return (
    <Alert tone="danger" className="rounded-2xl px-4 py-2.5 text-[12.5px] font-medium">
      {children}
    </Alert>
  );
}

/** A labelled text control: mono caption above a rounded input, like every WaDesk installer field. */
export function WizardField({
  label,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn('block', className)}>
      <span className={labelClass}>{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint && (
        <span className="mt-1 block text-[10.5px] leading-relaxed text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}

export function WizardInput({ className, ...rest }: ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn(
        'h-10 rounded-xl bg-muted px-3 text-[13px] focus-visible:bg-background focus-visible:ring-1',
        className,
      )}
      {...rest}
    />
  );
}

export function PrimaryButton({
  busy,
  children,
  className,
  disabled,
  ...rest
}: ComponentProps<typeof Button> & { busy?: boolean }) {
  const t = useTranslations(NS);
  return (
    <Button
      variant="brand"
      className={cn(
        'h-11 rounded-full px-6 text-[13px] font-semibold shadow-sm hover:bg-primary hover:opacity-100',
        className,
      )}
      {...rest}
      disabled={busy || disabled}
    >
      {busy && <Spinner label={t('working')} />}
      {children}
      {!busy && <Arrow />}
    </Button>
  );
}

export function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const t = useTranslations(NS);
  return (
    <Button
      variant="secondary"
      className="h-10 rounded-full px-5 text-[12.5px] font-semibold"
      onClick={onClick}
      disabled={disabled}
    >
      <Arrow dir="left" />
      {t('back')}
    </Button>
  );
}

/** Back on the start, the screen's main action on the end. */
export function NavRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 pt-1">{children}</div>;
}
