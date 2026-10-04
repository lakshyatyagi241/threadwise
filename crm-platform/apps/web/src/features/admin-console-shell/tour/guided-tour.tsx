'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Button } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import {
  TOUR_DELAY_MS,
  TOUR_START_EVENT,
  planTour,
  shouldRunTour,
  type TourStep,
} from './tour-model';

const NS = 'admin-console-shell.tour';

const visible = (selector: string): boolean => {
  const el = document.querySelector<HTMLElement>(selector);
  return Boolean(el && el.getClientRects().length > 0);
};

/**
 * The first-run spotlight tour (WD-ASHELL-023). It starts about 0.65 s after the dashboard loads for a person who has not seen
 * it, and every way out (Done, the close button, Escape, a click on the dimmed page) tells the server so it never auto-runs
 * again. Replaying is the "Take the tour" row of the account menu, or `/dashboard?tour=1`.
 */
export function GuidedTour({ run }: { run: boolean }) {
  const t = useTranslations(NS);
  const app = useTranslations('common')('appName');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const forced = params.get('tour') === '1';
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const seen = useRef(false);

  const markSeen = () => {
    if (seen.current) return;
    seen.current = true;
    void apiFetch('/shell/tour/seen', { method: 'POST' }).catch(() => undefined);
  };

  const begin = useEffectEvent(() => {
    const planned = planTour(visible);
    if (planned.length === 0) return;
    setIndex(0);
    setSteps(planned);
  });

  const finish = () => {
    setSteps(null);
    markSeen();
  };
  const escape = useEffectEvent(() => finish());

  // Auto-run: only on the dashboard, only until seen (or when ?tour=1 asks), after a short settle delay.
  useEffect(() => {
    if (!shouldRunTour({ run: run && !seen.current, pathname, forced })) return;
    const timer = window.setTimeout(() => {
      begin();
      if (forced) router.replace('/dashboard');
    }, TOUR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [run, pathname, forced, router]);

  // Replay from the account menu: run in place on the dashboard, otherwise go there with ?tour=1.
  useEffect(() => {
    const onStart = () => {
      if (pathname === '/dashboard') begin();
      else router.push('/dashboard?tour=1');
    };
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
  }, [pathname, router]);

  const step = steps?.[index];
  useEffect(() => {
    if (!step) return;
    const place = () => {
      const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setRect(el ? el.getBoundingClientRect() : null);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && escape();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [step]);

  if (!steps || !step) return null;
  const last = index === steps.length - 1;
  const pad = 8;
  const popoverStyle: React.CSSProperties = rect
    ? {
        top: Math.min(rect.bottom + pad + 12, window.innerHeight - 220),
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 340)),
      }
    : { top: '30%', left: '50%', transform: 'translateX(-50%)' };

  return (
    <div className="fixed inset-0 z-[80]" role="presentation" data-testid="guided-tour">
      {/* The dimmed page with a window cut out around the target. */}
      <div
        aria-hidden="true"
        onClick={finish}
        className="absolute inset-0"
        style={
          rect
            ? {
                top: rect.top - pad,
                left: rect.left - pad,
                width: rect.width + pad * 2,
                height: rect.height + pad * 2,
                borderRadius: 14,
                boxShadow: '0 0 0 9999px rgba(6, 32, 25, 0.55)',
              }
            : { background: 'rgba(6, 32, 25, 0.55)' }
        }
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(`steps.${step.id}.title`, { app })}
        style={popoverStyle}
        className="absolute w-[320px] max-w-[calc(100vw-1.5rem)] space-y-3 rounded-2xl border border-border bg-background p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">{t(`steps.${step.id}.title`, { app })}</h2>
          <button
            type="button"
            aria-label={t('close')}
            onClick={finish}
            className="rounded px-1 text-xl leading-none text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            ×
          </button>
        </div>
        <p className="text-sm text-muted-foreground">{t(`steps.${step.id}.body`, { app })}</p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {t('progress', { current: index + 1, total: steps.length })}
          </span>
          <span className="flex gap-2">
            {index > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setIndex(index - 1)}>
                {t('back')}
              </Button>
            )}
            <Button size="sm" onClick={() => (last ? finish() : setIndex(index + 1))}>
              {last ? t('done') : t('next')}
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
