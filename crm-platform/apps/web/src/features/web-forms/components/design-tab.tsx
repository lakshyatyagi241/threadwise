'use client';

import { useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Field, Select, cn } from '@crm/ui';
import { DesignColorField, useBufferedText } from './design-color-field';
import { PreviewFrame, type PreviewDevice } from './preview-frame';
import type { BuilderTabProps } from './builder-types';
import {
  DEFAULT_THEME,
  FONT_STACKS,
  THEME_PRESETS,
  THEME_PRESET_KEYS,
  applyPreset,
  contrastWarnings,
  presetOf,
  safeImageUrl,
  type ThemePresetKey,
} from '../lib/theme';
import { FORM_FONT_FAMILIES, type Definition, type ThemeTokens } from '../lib/types';

type ColourKey = 'primary' | 'background' | 'surface' | 'text' | 'mutedText' | 'border' | 'error';

const COLOUR_KEYS: ColourKey[] = [
  'primary',
  'background',
  'surface',
  'text',
  'mutedText',
  'border',
  'error',
];

/** Brand names stay as they are in every language; the three generic stacks are translated. */
const BRAND_FONT_NAMES: Record<string, string> = {
  inter: 'Inter',
  roboto: 'Roboto',
  open_sans: 'Open Sans',
  lato: 'Lato',
  poppins: 'Poppins',
  merriweather: 'Merriweather',
  nunito: 'Nunito',
};

/** The draft with some theme tokens replaced; everything else in the definition is untouched. */
export function withTheme(draft: Definition, patch: Partial<ThemeTokens>): Definition {
  return { ...draft, theme: { ...draft.theme, ...patch } };
}

/** What a typed image address means: empty clears it, an https address is kept as typed, anything else is refused (null). */
export function readImage(text: string): { value: string | null } | null {
  const v = text.trim();
  if (v === '') return { value: null };
  // The address is stored as typed, so it must already be what the contract accepts: no spaces for the URL parser to quietly encode.
  return !/\s/.test(v) && safeImageUrl(v) ? { value: v } : null;
}

/** A group of radio choices drawn as buttons: real radios underneath, so arrows, Tab and screen readers behave natively. */
function Choice<V extends string>({
  legend,
  hideLegend,
  value,
  options,
  onChange,
  disabled,
  columns,
}: {
  legend: string;
  hideLegend?: boolean;
  value: V;
  options: Array<{ value: V; label: ReactNode }>;
  onChange: (v: V) => void;
  disabled?: boolean;
  columns?: string;
}) {
  const name = useId();
  return (
    <fieldset className="min-w-0 space-y-1.5 text-sm" disabled={disabled}>
      <legend className={hideLegend ? 'sr-only' : 'mb-1.5 font-medium'}>{legend}</legend>
      <div className={cn('grid gap-2', columns ?? 'grid-cols-2 sm:grid-cols-3')}>
        {options.map((o) => (
          <label key={o.value} className="block">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                'flex min-h-10 cursor-pointer items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-center text-[13px]',
                'peer-checked:border-brand peer-checked:bg-brand/10 peer-checked:font-semibold peer-checked:text-brand',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
              )}
            >
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-4 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

function ImageField({
  id,
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string | null;
  disabled: boolean;
  onChange: (v: string | null) => void;
}) {
  const t = useTranslations('web-forms.design');
  const {
    text,
    onChange: type,
    invalid,
  } = useBufferedText(
    value ?? '',
    (v) => readImage(v) !== null,
    (v) => onChange(readImage(v)?.value ?? null),
  );
  return (
    <Field label={label} htmlFor={id} hint={hint} error={invalid ? t('images.invalid') : undefined}>
      <input
        id={id}
        type="url"
        dir="ltr"
        inputMode="url"
        autoComplete="off"
        placeholder="https://"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        value={text}
        onChange={(e) => type(e.target.value)}
        className={cn(
          'h-10 w-full rounded-md border bg-background px-3 text-start text-sm outline-none',
          'focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60',
          invalid ? 'border-danger ring-2 ring-danger/40' : 'border-border',
        )}
      />
    </Field>
  );
}

function MaxWidthField({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  const t = useTranslations('web-forms.design');
  const ok = (v: string) => /^\d{3}$/.test(v) && Number(v) >= 320 && Number(v) <= 960;
  const {
    text,
    onChange: type,
    invalid,
  } = useBufferedText(String(value), ok, (v) => onChange(Number(v)));
  return (
    <Field
      label={t('layout.maxWidth')}
      htmlFor={id}
      hint={t('layout.maxWidthHint')}
      error={invalid ? t('layout.maxWidthInvalid') : undefined}
    >
      <div className="flex items-center gap-3">
        <input
          type="range"
          aria-label={t('layout.maxWidthSlider')}
          min={320}
          max={960}
          step={10}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="min-w-0 flex-1 accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <input
          id={id}
          type="text"
          inputMode="numeric"
          dir="ltr"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          value={text}
          maxLength={3}
          onChange={(e) => type(e.target.value)}
          className={cn(
            'h-10 w-20 rounded-md border bg-background px-3 text-center font-mono text-sm outline-none',
            'focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60',
            invalid ? 'border-danger ring-2 ring-danger/40' : 'border-border',
          )}
        />
        <span className="text-xs text-muted-foreground" dir="ltr">
          px
        </span>
      </div>
    </Field>
  );
}

/**
 * The Design tab: every control edits `draft.theme` (tokens only, spec section 8) and the frame beside it shows the draft as it is
 * typed. Nothing here can write a value the contract would refuse: colours and addresses are held back until valid.
 */
export function DesignTab({ draft, setDraft, canEdit }: BuilderTabProps) {
  const t = useTranslations('web-forms.design');
  const uid = useId();
  const theme = draft.theme;
  const locked = !canEdit;
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>('light');
  const patch = (p: Partial<ThemeTokens>) => setDraft((d) => withTheme(d, p));
  const preset = presetOf(theme);
  const warnings = contrastWarnings(theme);
  // The light/dark switch only means something when the form can be dark.
  const canDark = theme.mode !== 'light';
  const forceMode = canDark && previewMode === 'dark' ? ('dark' as const) : undefined;

  const presetName: Record<ThemePresetKey, string> = {
    classic: t('presets.classic'),
    ocean: t('presets.ocean'),
    forest: t('presets.forest'),
    sunset: t('presets.sunset'),
    berry: t('presets.berry'),
    slate: t('presets.slate'),
    noir: t('presets.noir'),
    paper: t('presets.paper'),
  };
  const colourName: Record<ColourKey, string> = {
    primary: t('colours.primary'),
    background: t('colours.background'),
    surface: t('colours.surface'),
    text: t('colours.text'),
    mutedText: t('colours.mutedText'),
    border: t('colours.border'),
    error: t('colours.error'),
  };
  const fontName: Record<string, string> = {
    ...BRAND_FONT_NAMES,
    system: t('fonts.system'),
    serif: t('fonts.serif'),
    mono: t('fonts.mono'),
  };
  const pairName = {
    text: t('contrast.text'),
    muted: t('contrast.muted'),
    button: t('contrast.button'),
  };

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        <Section title={t('presets.title')}>
          <div className="grid grid-cols-2 gap-2">
            {THEME_PRESET_KEYS.map((key) => {
              const p = { ...DEFAULT_THEME, ...THEME_PRESETS[key] };
              return (
                <label key={key} className="block">
                  <input
                    type="radio"
                    name={`${uid}-preset`}
                    value={key}
                    checked={preset === key}
                    disabled={locked}
                    onChange={() => setDraft((d) => ({ ...d, theme: applyPreset(d.theme, key) }))}
                    className="peer sr-only"
                  />
                  <span
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background p-2',
                      'peer-checked:border-brand peer-checked:ring-2 peer-checked:ring-brand/30',
                      'peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
                    )}
                  >
                    <span
                      aria-hidden
                      className="flex shrink-0 overflow-hidden rounded border border-border"
                      style={{ background: p.background }}
                    >
                      <span className="block size-6" style={{ background: p.primary }} />
                      <span className="block size-6" style={{ background: p.surface }} />
                      <span className="block size-6" style={{ background: p.text }} />
                    </span>
                    <span className="min-w-0 truncate text-[13px] font-medium">
                      {presetName[key]}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {preset === null ? (
            <p className="text-xs text-muted-foreground" data-testid="preset-custom">
              {t('presets.custom')}
            </p>
          ) : null}
        </Section>

        <Section title={t('colours.title')}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {COLOUR_KEYS.map((key) => (
              <Field key={key} label={colourName[key]} htmlFor={`${uid}-c-${key}`}>
                <DesignColorField
                  id={`${uid}-c-${key}`}
                  value={theme[key]}
                  swatchLabel={t('colours.swatch', { name: colourName[key] })}
                  disabled={locked}
                  onChange={(hex) => patch({ [key]: hex })}
                />
              </Field>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('colours.hint')}</p>
          {warnings.length > 0 ? (
            <Alert tone="warning" data-testid="contrast-warning">
              <p className="font-medium">{t('contrast.title')}</p>
              <ul className="mt-1 list-disc ps-5">
                {warnings.map((w) => (
                  <li key={w.pair}>
                    {t('contrast.item', { pair: pairName[w.pair], ratio: w.ratio.toFixed(2) })}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : (
            <p className="text-xs text-success">{t('contrast.ok')}</p>
          )}
        </Section>

        <Section title={t('shape.title')}>
          <Choice
            legend={t('shape.radius')}
            value={theme.radius}
            disabled={locked}
            onChange={(radius) => patch({ radius })}
            columns="grid-cols-3 sm:grid-cols-5"
            options={[
              { value: 'none', label: t('shape.none') },
              { value: 'sm', label: t('shape.sm') },
              { value: 'md', label: t('shape.md') },
              { value: 'lg', label: t('shape.lg') },
              { value: 'pill', label: t('shape.pill') },
            ]}
          />
          <Choice
            legend={t('shape.density')}
            value={theme.density}
            disabled={locked}
            onChange={(density) => patch({ density })}
            options={[
              { value: 'compact', label: t('shape.compact') },
              { value: 'comfortable', label: t('shape.comfortable') },
              { value: 'spacious', label: t('shape.spacious') },
            ]}
          />
          <Choice
            legend={t('shape.shadow')}
            value={theme.shadow}
            disabled={locked}
            onChange={(shadow) => patch({ shadow })}
            columns="grid-cols-2 sm:grid-cols-4"
            options={[
              { value: 'none', label: t('shape.shadowNone') },
              { value: 'sm', label: t('shape.sm') },
              { value: 'md', label: t('shape.md') },
              { value: 'lg', label: t('shape.lg') },
            ]}
          />
        </Section>

        <Section title={t('type.title')}>
          <Field label={t('type.font')} htmlFor={`${uid}-font`} hint={t('type.fontHint')}>
            <Select
              id={`${uid}-font`}
              value={theme.fontFamily}
              disabled={locked}
              onChange={(e) => patch({ fontFamily: e.target.value as ThemeTokens['fontFamily'] })}
            >
              {FORM_FONT_FAMILIES.map((f) => (
                <option key={f} value={f} style={{ fontFamily: FONT_STACKS[f] }}>
                  {fontName[f]}
                </option>
              ))}
            </Select>
            <p
              className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
              style={{ fontFamily: FONT_STACKS[theme.fontFamily] }}
            >
              {t('type.sample')}
            </p>
          </Field>
          <Field label={t('type.scale')} htmlFor={`${uid}-scale`}>
            <div className="flex items-center gap-3">
              <input
                id={`${uid}-scale`}
                type="range"
                min={0.8}
                max={1.4}
                step={0.05}
                disabled={locked}
                value={theme.fontScale}
                aria-valuetext={`${Math.round(theme.fontScale * 100)}%`}
                onChange={(e) => patch({ fontScale: Number(e.target.value) })}
                className="min-w-0 flex-1 accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <output
                htmlFor={`${uid}-scale`}
                dir="ltr"
                className="w-12 text-end font-mono text-sm"
              >
                {Math.round(theme.fontScale * 100)}%
              </output>
            </div>
          </Field>
        </Section>

        <Section title={t('layout.title')}>
          <Choice
            legend={t('layout.preset')}
            value={theme.layout}
            disabled={locked}
            onChange={(layout) => patch({ layout })}
            columns="grid-cols-2"
            options={[
              { value: 'classic', label: t('layout.classic') },
              { value: 'full_width', label: t('layout.fullWidth') },
              { value: 'split', label: t('layout.split') },
              { value: 'minimal', label: t('layout.minimal') },
            ]}
          />
          <Choice
            legend={t('layout.labelPosition')}
            value={theme.labelPosition === 'left' ? 'left' : 'top'}
            disabled={locked}
            onChange={(labelPosition) => patch({ labelPosition })}
            columns="grid-cols-2"
            options={[
              { value: 'top', label: t('layout.labelTop') },
              { value: 'left', label: t('layout.labelLeft') },
            ]}
          />
          <Choice
            legend={t('layout.buttonStyle')}
            value={theme.buttonStyle}
            disabled={locked}
            onChange={(buttonStyle) => patch({ buttonStyle })}
            columns="grid-cols-2"
            options={[
              { value: 'filled', label: t('layout.filled') },
              { value: 'outline', label: t('layout.outline') },
            ]}
          />
          <Choice
            legend={t('layout.buttonWidth')}
            value={theme.buttonWidth}
            disabled={locked}
            onChange={(buttonWidth) => patch({ buttonWidth })}
            columns="grid-cols-2"
            options={[
              { value: 'auto', label: t('layout.widthAuto') },
              { value: 'full', label: t('layout.widthFull') },
            ]}
          />
          <MaxWidthField
            id={`${uid}-max`}
            value={theme.maxWidth}
            disabled={locked}
            onChange={(maxWidth) => patch({ maxWidth })}
          />
          <Choice
            legend={t('layout.mode')}
            value={theme.mode}
            disabled={locked}
            onChange={(mode) => patch({ mode })}
            columns="grid-cols-3"
            options={[
              { value: 'light', label: t('layout.light') },
              { value: 'dark', label: t('layout.dark') },
              { value: 'auto', label: t('layout.auto') },
            ]}
          />
        </Section>

        <Section title={t('images.title')}>
          <ImageField
            id={`${uid}-logo`}
            label={t('images.logo')}
            hint={t('images.logoHint')}
            value={theme.logo}
            disabled={locked}
            onChange={(logo) => patch({ logo })}
          />
          {theme.layout === 'split' ? (
            <ImageField
              id={`${uid}-cover`}
              label={t('images.cover')}
              hint={t('images.coverHint')}
              value={theme.coverImage}
              disabled={locked}
              onChange={(coverImage) => patch({ coverImage })}
            />
          ) : null}
          <ImageField
            id={`${uid}-bg`}
            label={t('images.background')}
            hint={t('images.backgroundHint')}
            value={theme.backgroundImage}
            disabled={locked}
            onChange={(backgroundImage) => patch({ backgroundImage })}
          />
        </Section>

        <Button
          type="button"
          variant="secondary"
          disabled={locked}
          onClick={() => setDraft((d) => ({ ...d, theme: { ...DEFAULT_THEME } }))}
        >
          {t('reset')}
        </Button>
        {locked ? <p className="text-xs text-muted-foreground">{t('readOnly')}</p> : null}
      </div>

      <section
        aria-labelledby={`${uid}-preview`}
        className="min-w-0 xl:sticky xl:top-4 xl:self-start"
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id={`${uid}-preview`} className="text-sm font-semibold">
            {t('preview.title')}
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <Choice
              legend={t('preview.device')}
              hideLegend
              value={device}
              onChange={setDevice}
              columns="grid-cols-3"
              options={[
                { value: 'desktop', label: t('preview.desktop') },
                { value: 'mobile', label: t('preview.mobile') },
                { value: 'popup', label: t('preview.popup') },
              ]}
            />
            <Choice
              legend={t('preview.scheme')}
              hideLegend
              value={previewMode}
              disabled={!canDark}
              onChange={setPreviewMode}
              columns="grid-cols-2"
              options={[
                { value: 'light', label: t('preview.light') },
                { value: 'dark', label: t('preview.dark') },
              ]}
            />
          </div>
        </div>
        {!canDark ? (
          <p className="mb-2 text-xs text-muted-foreground">{t('preview.schemeHint')}</p>
        ) : null}
        <PreviewFrame form={draft} device={device} forceMode={forceMode} />
      </section>
    </div>
  );
}
