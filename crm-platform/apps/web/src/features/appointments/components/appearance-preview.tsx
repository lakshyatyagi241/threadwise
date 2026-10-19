'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { DEFAULT_BOOKING_THEME } from '@crm/contracts';
import { cn } from '@crm/ui';
import { PreviewFrame } from '@/features/auth-registration-security/platform/settings/preview-frame';
import type { PublicDirectory, PublicType } from '../api/schemas';
import type { ThemeView } from '../lib/booking-theme';
import type { Slot } from '../lib/slots';
import { browserZone } from '../lib/zone';
import { DirectoryBody } from './public-directory';
import { Service } from './public-booking';
import { PublicShell } from './public-shell';

type Device = 'desktop' | 'mobile';
type Page = 'service' | 'list';
type Scheme = 'theme' | 'light' | 'dark';

/** The phone is the common iPhone / Android width (375 CSS pixels), the desktop a laptop screen. */
const WIDTHS = { desktop: 1024, mobile: 375 } as const;

/** Open times for the sample service: weekdays, every half hour from 09:00 to 16:30 UTC, none in the past. */
function sampleSlots(range: { from: string; to: string }): Slot[] {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  const now = Date.now();
  const out: Slot[] = [];
  if (Number.isNaN(from) || Number.isNaN(to)) return out;
  const day = new Date(from);
  day.setUTCHours(0, 0, 0, 0);
  for (let d = day.getTime() - 86_400_000; d < to; d += 86_400_000) {
    const weekday = new Date(d).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (let minutes = 9 * 60; minutes < 17 * 60; minutes += 30) {
      const start = d + minutes * 60_000;
      if (start < Math.max(now, from) || start >= to) continue;
      out.push({
        start: new Date(start).toISOString(),
        end: new Date(start + 30 * 60_000).toISOString(),
        remaining: null,
      });
    }
  }
  return out;
}

/**
 * The live preview (BL-357): the REAL booking page, drawn with the draft theme inside a frame as wide as a laptop or a phone, so the
 * page's own layout rules answer to that width. Nothing is sent: the times are made up here and the confirm button books nothing.
 */
export function AppearancePreview({
  view,
  orgName,
  orgSlug,
  typeName,
}: {
  view: ThemeView;
  orgName: string;
  orgSlug: string;
  /** The service being edited, or null for the workspace (a sample service stands in). */
  typeName: string | null;
}) {
  const t = useTranslations('appointments.appearance.preview');
  const [device, setDevice] = useState<Device>('desktop');
  const [page, setPage] = useState<Page>('service');
  const [rtl, setRtl] = useState(false);
  const [scheme, setScheme] = useState<Scheme>('theme');

  const shown = useMemo<ThemeView>(
    () => (scheme === 'theme' ? view : { ...view, colorMode: scheme }),
    [view, scheme],
  );

  const sample = useMemo<PublicType>(
    () => ({
      slug: 'sample',
      name: typeName ?? t('sampleName'),
      description: t('sampleDescription'),
      locationType: 'virtual',
      locationValue: null,
      color: null,
      durationMinutes: 30,
      introMessage: t('sampleIntro'),
      timezone: browserZone(),
      maxAdvanceDays: 60,
      requiresApproval: false,
      currency: null,
      feeMinor: 0,
      taxPct: 0,
      dueNowMinor: 0,
      questions: [
        {
          label: t('sampleQuestion'),
          type: 'textarea',
          options: [],
          required: false,
          mapToContactField: null,
        },
      ],
      consent: null,
    }),
    [t, typeName],
  );

  const directory = useMemo<PublicDirectory>(
    () => ({
      org: { name: orgName, slug: orgSlug },
      types: [sample, { ...sample, slug: 'sample-2', name: t('sampleName2'), durationMinutes: 60 }],
      theme: DEFAULT_BOOKING_THEME,
    }),
    [orgName, orgSlug, sample, t],
  );

  // A link inside the frame would navigate the frame away from the preview; the preview only shows.
  const stop = useCallback((e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a')) e.preventDefault();
  }, []);

  return (
    <section aria-label={t('title')} className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="me-auto text-base font-semibold">{t('title')}</h2>
        <Segmented
          label={t('device')}
          value={device}
          onChange={setDevice}
          options={[
            { id: 'desktop', label: t('desktop') },
            { id: 'mobile', label: t('mobile') },
          ]}
        />
        <Segmented
          label={t('page')}
          value={page}
          onChange={setPage}
          options={[
            { id: 'service', label: t('servicePage') },
            { id: 'list', label: t('serviceList') },
          ]}
        />
        <Segmented
          label={t('scheme')}
          value={scheme}
          onChange={setScheme}
          options={[
            { id: 'theme', label: t('asSet') },
            { id: 'light', label: t('light') },
            { id: 'dark', label: t('dark') },
          ]}
        />
        <Segmented
          label={t('direction')}
          value={rtl ? 'rtl' : 'ltr'}
          onChange={(v) => setRtl(v === 'rtl')}
          options={[
            { id: 'ltr', label: t('ltr') },
            { id: 'rtl', label: t('rtl') },
          ]}
        />
      </div>
      <PreviewFrame
        device={device}
        title={t('frameTitle')}
        widths={WIDTHS}
        height={device === 'mobile' ? 820 : 760}
      >
        {/* The frame is a separate document: the direction is set on the page's own root, as it would be for a visitor. */}
        <div dir={rtl ? 'rtl' : 'ltr'} onClickCapture={stop} data-testid="booking-preview">
          <PublicShell view={shown} orgName={orgName} org={orgSlug} preview>
            {page === 'service' ? (
              <Service
                key={`${device}-${typeName ?? ''}`}
                org={orgSlug}
                slug="sample"
                orgName={orgName}
                type={sample}
                preview={{ loadSlots: (range) => Promise.resolve(sampleSlots(range)) }}
              />
            ) : (
              <DirectoryBody org={orgSlug} data={directory} />
            )}
          </PublicShell>
        </div>
      </PreviewFrame>
      <p className="text-xs text-muted-foreground">{t('note')}</p>
    </section>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: ReactNode }>;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-md border border-border p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'min-h-8 rounded px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary',
            value === o.id
              ? 'bg-brand text-brand-foreground'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
