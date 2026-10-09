'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@crm/ui';
import { ChevronLeftIcon } from '../icons';
import { SparkIcon } from './parts';

/**
 * The bar across the top of the builder (Reference's sticky header): back, where you are, the draft chip, "Build with AI" and
 * "Save draft". Editing a campaign keeps the title and the back link; a campaign that already exists has no draft chip or draft button.
 */
export function BuilderHeader({
  editing,
  backHref,
  busy,
  canDraft,
  onAi,
  onDraft,
  actions,
}: {
  editing: boolean;
  backHref: string;
  busy: boolean;
  canDraft: boolean;
  /** Build with AI; left out, the button is not shown (the guided flow has no AI brief). */
  onAi?: (() => void) | undefined;
  onDraft: () => void;
  /** Extra controls at the right end (the guided flow's Back, Next and launch buttons). */
  actions?: React.ReactNode;
}) {
  const t = useTranslations('campaigns.builder');
  return (
    <header className="sticky top-14 z-20 border-b border-border bg-background">
      <div className="mx-auto flex max-w-none flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={backHref}
            aria-label={t('back')}
            title={t('back')}
            className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted"
          >
            <ChevronLeftIcon className="size-3.5" />
          </Link>
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {editing ? t('kickerEdit') : t('kicker')}
            </div>
            <h1 className="truncate text-xl leading-tight">
              {editing ? t('titleEdit') : t('title')}{' '}
              <span className="italic text-brand">{t('titleAccent')}</span>
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] font-medium text-muted-foreground">
              {t('draftChip')}
            </span>
          )}
          {onAi && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full border-brand/40 text-brand"
              onClick={onAi}
            >
              <SparkIcon className="size-3.5" />
              {t('ai.open')}
            </Button>
          )}
          {!editing && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full"
              disabled={busy || !canDraft}
              onClick={onDraft}
            >
              {t('submit.draft')}
            </Button>
          )}
          {actions}
        </div>
      </div>
    </header>
  );
}
