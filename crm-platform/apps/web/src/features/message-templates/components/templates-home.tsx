'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { TemplateGalleryView } from './gallery-view';
import { TemplatesScreen } from './templates-screen';

type View = 'saved' | 'gallery';
const VIEWS: readonly View[] = ['saved', 'gallery'];

/**
 * `/templates`: two tabs. **Saved templates** is the library of templates the workspace created or synced; a plain visit always
 * opens it. **Template gallery** is the platform's default templates, kept apart from the library. The gallery is `?view=gallery`,
 * so Back from a template made from it returns to the gallery.
 */
export function TemplatesHome({ apiBaseUrl }: { apiBaseUrl: string }) {
  const t = useTranslations('message-templates.home');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view: View = params.get('view') === 'gallery' ? 'gallery' : 'saved';

  function show(next: View) {
    const p = new URLSearchParams(params.toString());
    if (next === 'gallery') p.set('view', 'gallery');
    else p.delete('view');
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Arrow keys, Home and End move between the tabs, as a tab list does.
  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next =
      e.key === 'Home'
        ? VIEWS[0]!
        : e.key === 'End'
          ? VIEWS[VIEWS.length - 1]!
          : VIEWS[(VIEWS.indexOf(view) + step + VIEWS.length) % VIEWS.length]!;
    show(next);
    requestAnimationFrame(() => document.getElementById(`templates-tab-${next}`)?.focus());
  }

  const pill = (active: boolean) =>
    cn(
      'rounded-full px-5 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
      active ? 'bg-foreground text-background' : 'bg-muted text-foreground hover:bg-muted/70',
    );

  return (
    <>
      <div
        role="tablist"
        aria-label={t('label')}
        className="flex flex-wrap gap-3 px-4 pt-5 sm:px-6 lg:px-7"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            id={`templates-tab-${v}`}
            aria-selected={view === v}
            aria-controls="templates-panel"
            tabIndex={view === v ? 0 : -1}
            className={pill(view === v)}
            onClick={() => show(v)}
            onKeyDown={onKey}
          >
            {t(v)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="templates-panel" aria-labelledby={`templates-tab-${view}`}>
        {view === 'gallery' ? (
          <div className="px-4 pt-2 sm:px-6 lg:px-7">
            <TemplateGalleryView />
          </div>
        ) : (
          <TemplatesScreen apiBaseUrl={apiBaseUrl} />
        )}
      </div>
    </>
  );
}
