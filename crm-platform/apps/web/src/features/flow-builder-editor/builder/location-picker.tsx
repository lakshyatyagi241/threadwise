'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  flbCoordinateProblem,
  flbFormatCoordinate,
  flbMapsLink,
  flbParseCoordinate,
  flbParseMapsInput,
  type FlbLocationProblem,
} from '@crm/contracts';
import { cn } from '@crm/ui';
import { flowsApi } from '../api/flows';

type Data = Record<string, unknown>;
type Mode = 'link' | 'coords';

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const RESOLVE_DELAY_MS = 600;

/** The mode a step shows: its own choice, else coordinates for a step saved before the modes existed that already has some. */
export function locationMode(d: Data): Mode {
  if (d.locMode === 'link' || d.locMode === 'coords') return d.locMode;
  return str(d.lat).trim() || str(d.lng).trim() ? 'coords' : 'link';
}

const inputClass = (invalid: boolean) =>
  cn(
    'w-full rounded-lg border bg-background px-3 py-2 text-[13px] outline-none focus:ring-4',
    invalid
      ? 'border-danger focus:border-danger focus:ring-danger/10'
      : 'border-border focus:border-brand focus:ring-brand/10',
  );

function Label({ id, children, hint }: { id: string; children: string; hint?: string }) {
  return (
    <label htmlFor={id} className="mb-1.5 block text-[12px] font-semibold text-foreground/80">
      {children}
      {hint ? <span className="ms-1 font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Problem({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} role="alert" className="mt-1.5 text-[11.5px] leading-snug text-danger">
      {children}
    </p>
  );
}

/**
 * The Location step's form (Simple builder and the Advanced inspector share it): a Google Maps link or a latitude and
 * longitude, checked as you type with the rules the runtime and Save use (`flbCoordinateProblem`), the place found echoed
 * back with an "Open in Google Maps" link, and the place name and address as optional extras. A short link is looked up on
 * the server (the only part that needs it); `lat` / `lng` always hold the resolved coordinates, so a step reads the same
 * whichever way it was entered.
 */
export function LocationPicker({
  data,
  patch,
  idPrefix,
}: {
  data: Data;
  patch: (p: Record<string, unknown>) => void;
  idPrefix: string;
}) {
  const t = useTranslations('flb.builder.location');
  const mode = locationMode(data);
  const mapsUrl = str(data.mapsUrl);
  const lat = str(data.lat);
  const lng = str(data.lng);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [lookup, setLookup] = useState<'idle' | 'busy' | FlbLocationProblem>('idle');
  const latest = useRef(mapsUrl);
  useEffect(() => {
    latest.current = mapsUrl;
  }, [mapsUrl]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  /** True while the text in the box is still the short link that was sent (it may have been edited while the lookup ran). */
  const stillAsked = (url: string): boolean => {
    const now = flbParseMapsInput(latest.current);
    return now.kind === 'short' && now.url === url;
  };

  const resolve = async (url: string) => {
    setLookup('busy');
    let out: Awaited<ReturnType<typeof flowsApi.resolveMapsLink>>;
    try {
      out = await flowsApi.resolveMapsLink({ url });
    } catch {
      if (stillAsked(url)) setLookup('resolve_failed');
      return;
    }
    if (!stillAsked(url)) return; // the link changed while this one was being looked up
    if (out.ok) {
      patch({ lat: flbFormatCoordinate(out.lat), lng: flbFormatCoordinate(out.lng) });
      setLookup('idle');
    } else {
      setLookup(out.problem as FlbLocationProblem);
    }
  };

  const onLink = (value: string, immediate: boolean) => {
    clearTimeout(timer.current);
    latest.current = value;
    const parsed = flbParseMapsInput(value);
    if (parsed.kind === 'coords') {
      setLookup('idle');
      patch({
        mapsUrl: value,
        lat: flbFormatCoordinate(parsed.lat),
        lng: flbFormatCoordinate(parsed.lng),
      });
      return;
    }
    // Whatever was resolved for the old link no longer applies.
    patch({ mapsUrl: value, lat: '', lng: '' });
    if (parsed.kind === 'short') {
      setLookup('idle');
      const url = parsed.url;
      if (immediate) void resolve(url);
      else timer.current = setTimeout(() => void resolve(url), RESOLVE_DELAY_MS);
    } else {
      setLookup('idle');
    }
  };

  const setMode = (next: Mode) => {
    if (next !== mode) patch({ locMode: next });
  };

  const onCoord = (key: 'lat' | 'lng', value: string) => {
    // "18.5204, 73.8567" pasted into either box fills both.
    // (a lone `18,5204` is a decimal comma, not a pair: the separator needs a space, a semicolon, or a dotted second number)
    const pair = /^\s*(-?\d+(?:\.\d+)?)\s*(?:;|,\s+|,(?=-?\d+\.))\s*(-?\d+(?:\.\d+)?)\s*$/.exec(
      value,
    );
    if (pair) {
      patch({ lat: pair[1], lng: pair[2] });
      return;
    }
    patch({ [key]: value });
  };
  const normalise = (key: 'lat' | 'lng') => {
    setTouched((s) => ({ ...s, [key]: true }));
    const raw = key === 'lat' ? lat : lng;
    const n = flbParseCoordinate(raw);
    if (n !== null && String(n) !== raw.trim()) patch({ [key]: flbFormatCoordinate(n) });
  };

  const problemText = (p: FlbLocationProblem) => t(`problem.${p}`);

  // What is wrong with what is on screen, if anything.
  let linkProblem: FlbLocationProblem | null = null;
  const parsedLink = mode === 'link' && mapsUrl.trim() ? flbParseMapsInput(mapsUrl) : null;
  if (parsedLink?.kind === 'invalid') linkProblem = parsedLink.problem;
  else if (parsedLink?.kind === 'short' && lookup !== 'idle' && lookup !== 'busy')
    linkProblem = lookup;
  const showLinkProblem = linkProblem && (touched.link || linkProblem !== 'not_url');

  const coordProblem = (key: 'lat' | 'lng'): FlbLocationProblem | null => {
    const v = key === 'lat' ? lat : lng;
    if (!v.trim()) return touched[key] ? (`${key}_missing` as FlbLocationProblem) : null;
    // Judge one box at a time: the other one being empty is its own message.
    const p = flbCoordinateProblem(key === 'lat' ? v : '0.1', key === 'lng' ? v : '0.1');
    return p === `${key}_nan` || p === `${key}_range` ? p : null;
  };
  const latProblem = mode === 'coords' ? coordProblem('lat') : null;
  const lngProblem = mode === 'coords' ? coordProblem('lng') : null;
  const zero =
    mode === 'coords' && !latProblem && !lngProblem && flbCoordinateProblem(lat, lng) === 'zero';

  const found = flbCoordinateProblem(lat, lng) === null;
  const fl = flbParseCoordinate(lat);
  const fg = flbParseCoordinate(lng);

  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label={t('modeLabel')}
        className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-[12px] font-medium"
      >
        {(['link', 'coords'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            id={id(`tab-${m}`)}
            aria-selected={mode === m}
            aria-controls={id(`panel-${m}`)}
            onClick={() => setMode(m)}
            className={cn(
              'rounded-md px-2 py-1.5 transition-colors',
              mode === m
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(m === 'link' ? 'modeLink' : 'modeCoords')}
          </button>
        ))}
      </div>

      {mode === 'link' ? (
        <div role="tabpanel" id={id('panel-link')} aria-labelledby={id('tab-link')}>
          <Label id={id('link')}>{t('linkLabel')}</Label>
          <input
            id={id('link')}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={mapsUrl}
            placeholder={t('linkPlaceholder')}
            aria-invalid={showLinkProblem ? true : undefined}
            aria-describedby={showLinkProblem ? id('link-err') : id('link-hint')}
            className={inputClass(Boolean(showLinkProblem))}
            onChange={(e) => onLink(e.target.value, false)}
            onPaste={(e) => {
              // A pasted link is complete: look it up now instead of after the typing pause.
              const pasted = e.clipboardData.getData('text');
              if (pasted) {
                e.preventDefault();
                setTouched((s) => ({ ...s, link: true }));
                onLink(pasted.trim(), true);
              }
            }}
            onBlur={() => {
              setTouched((s) => ({ ...s, link: true }));
              if (parsedLink?.kind === 'short' && lookup === 'idle' && !found) {
                clearTimeout(timer.current);
                void resolve(parsedLink.url);
              }
            }}
          />
          {showLinkProblem && linkProblem ? (
            <div className="flex items-start justify-between gap-2">
              <Problem id={id('link-err')}>{problemText(linkProblem)}</Problem>
              {linkProblem === 'resolve_failed' && parsedLink?.kind === 'short' ? (
                <button
                  type="button"
                  className="mt-1.5 shrink-0 text-[11.5px] font-medium text-brand hover:underline"
                  onClick={() => void resolve(parsedLink.url)}
                >
                  {t('retry')}
                </button>
              ) : null}
            </div>
          ) : (
            <p
              id={id('link-hint')}
              className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground"
            >
              {lookup === 'busy' ? t('finding') : t('linkHint')}
            </p>
          )}
        </div>
      ) : (
        <div role="tabpanel" id={id('panel-coords')} aria-labelledby={id('tab-coords')}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label id={id('lat')}>{t('latitude')}</Label>
              <input
                id={id('lat')}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={lat}
                placeholder="18.5204"
                aria-invalid={latProblem ? true : undefined}
                aria-describedby={latProblem ? id('lat-err') : undefined}
                className={inputClass(Boolean(latProblem))}
                onChange={(e) => onCoord('lat', e.target.value)}
                onBlur={() => normalise('lat')}
              />
              {latProblem ? <Problem id={id('lat-err')}>{problemText(latProblem)}</Problem> : null}
            </div>
            <div>
              <Label id={id('lng')}>{t('longitude')}</Label>
              <input
                id={id('lng')}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={lng}
                placeholder="73.8567"
                aria-invalid={lngProblem ? true : undefined}
                aria-describedby={lngProblem ? id('lng-err') : undefined}
                className={inputClass(Boolean(lngProblem))}
                onChange={(e) => onCoord('lng', e.target.value)}
                onBlur={() => normalise('lng')}
              />
              {lngProblem ? <Problem id={id('lng-err')}>{problemText(lngProblem)}</Problem> : null}
            </div>
          </div>
          {zero ? <Problem id={id('zero')}>{problemText('zero')}</Problem> : null}
          {!latProblem && !lngProblem && !zero ? (
            <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
              {t('coordsHint')}
            </p>
          ) : null}
        </div>
      )}

      {found && fl !== null && fg !== null ? (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg border border-success/30 bg-success/10 px-3 py-2"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4 shrink-0 text-success"
            fill="none"
            aria-hidden
          >
            <path
              d="M3 8.5l3.2 3L13 4.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-foreground">{t('found')}</div>
            <div dir="ltr" className="truncate font-mono text-[11px] text-muted-foreground">
              {flbFormatCoordinate(fl)}, {flbFormatCoordinate(fg)}
            </div>
          </div>
          <a
            href={flbMapsLink(fl, fg)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[11.5px] font-medium text-brand hover:underline"
          >
            {t('openInMaps')}
          </a>
        </div>
      ) : mode === 'link' && lookup === 'busy' ? (
        <div role="status" className="text-[11.5px] text-muted-foreground">
          {t('finding')}
        </div>
      ) : null}

      <div className="border-t border-border pt-3">
        <p className="mb-2 text-[11.5px] leading-snug text-muted-foreground">{t('optionalHint')}</p>
        <div className="space-y-3">
          <div>
            <Label id={id('title')} hint={t('optional')}>
              {t('placeName')}
            </Label>
            <input
              id={id('title')}
              type="text"
              value={str(data.title)}
              placeholder={t('placePlaceholder')}
              className={inputClass(false)}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </div>
          <div>
            <Label id={id('address')} hint={t('optional')}>
              {t('address')}
            </Label>
            <input
              id={id('address')}
              type="text"
              value={str(data.address)}
              className={inputClass(false)}
              onChange={(e) => patch({ address: e.target.value })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
