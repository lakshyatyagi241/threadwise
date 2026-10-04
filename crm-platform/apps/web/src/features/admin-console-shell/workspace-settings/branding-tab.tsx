'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState, type DragEvent } from 'react';
import type { WorkspaceBrandingResponse } from '@crm/contracts';
import { Alert, Button, Card, Spinner, cn } from '@crm/ui';
import { useBranding, useSaveBranding } from './api';
import { colourChanged, DEFAULT_BRAND, normaliseColour } from './logic';

const NS = 'admin-console-shell.workspaceSettings.branding';

/**
 * WD-ASHELL-036: logo and favicon dropzones and three brand colours (the colour picker and the text box stay in step).
 * Owner only. The shell applies the result for the whole workspace (WD-ASHELL-025).
 */
export function BrandingTab() {
  const t = useTranslations(NS);
  const q = useBranding();
  if (q.isPending) return <Spinner />;
  if (q.isError || !q.data) return <Alert tone="danger">{t('loadFailed')}</Alert>;
  return <BrandingForm data={q.data} />;
}

type ColourKey = 'primary' | 'accent' | 'background';
const COLOURS: readonly ColourKey[] = ['primary', 'accent', 'background'];

function BrandingForm({ data }: { data: WorkspaceBrandingResponse }) {
  const t = useTranslations(NS);
  const save = useSaveBranding();
  const locked = !data.isOwner;
  const initial: Record<ColourKey, string> = {
    primary: data.primary ?? DEFAULT_BRAND.primary,
    accent: data.accent ?? DEFAULT_BRAND.accent,
    background: data.background ?? DEFAULT_BRAND.background,
  };
  const [colours, setColours] = useState<Record<ColourKey, string>>(initial);
  const [files, setFiles] = useState<{ logo?: File; favicon?: File }>({});
  const [saved, setSaved] = useState(false);
  const bad = COLOURS.find((k) => normaliseColour(colours[k]) === null);

  const submit = () => {
    setSaved(false);
    const fields: Partial<Record<ColourKey, string>> = {};
    for (const k of COLOURS) {
      if (colourChanged(colours[k], initial[k])) fields[k] = colours[k];
    }
    save.mutate(
      { fields, files },
      {
        onSuccess: () => {
          setSaved(true);
          setFiles({});
        },
      },
    );
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!bad) submit();
      }}
    >
      {locked && <p className="text-xs italic text-muted-foreground">{t('ownerOnly')}</p>}
      {saved && <Alert tone="success">{t('saved')}</Alert>}
      {save.isError && <Alert tone="danger">{t('saveFailed')}</Alert>}
      <Card className="space-y-1 p-6">
        <h2 className="font-serif text-xl">{t('logoTitle')}</h2>
        <p className="mb-4 text-xs text-muted-foreground">{t('logoBody')}</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Dropzone
            slot="logo"
            label={t('logo')}
            hint={t('logoHint')}
            current={data.logoUrl}
            file={files.logo}
            disabled={locked}
            onFile={(f) => setFiles((s) => ({ ...s, logo: f }))}
          />
          <Dropzone
            slot="favicon"
            label={t('favicon')}
            hint={t('faviconHint')}
            current={data.faviconUrl}
            file={files.favicon}
            disabled={locked}
            onFile={(f) => setFiles((s) => ({ ...s, favicon: f }))}
          />
        </div>
      </Card>
      <Card className="space-y-1 p-6">
        <h2 className="font-serif text-xl">{t('coloursTitle')}</h2>
        <p className="mb-4 text-xs text-muted-foreground">{t('coloursBody')}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {COLOURS.map((k) => (
            <ColourField
              key={k}
              label={t(`colours.${k}`)}
              value={colours[k]}
              disabled={locked}
              invalid={bad === k}
              onChange={(v) => setColours((s) => ({ ...s, [k]: v }))}
            />
          ))}
        </div>
        {bad && <p className="pt-2 text-xs text-danger">{t('colourInvalid')}</p>}
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="submit" disabled={locked || save.isPending || Boolean(bad)}>
            {t('save')}
          </Button>
        </div>
      </Card>
    </form>
  );
}

function ColourField(props: {
  label: string;
  value: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const picker = normaliseColour(props.value) ?? '#000000';
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold">
        {props.label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={props.label}
          value={picker}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
          className="size-10 rounded-lg border border-border bg-background"
        />
        <input
          id={id}
          type="text"
          value={props.value}
          disabled={props.disabled}
          aria-invalid={props.invalid || undefined}
          maxLength={7}
          onChange={(e) => props.onChange(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
        />
      </div>
    </div>
  );
}

function Dropzone(props: {
  slot: 'logo' | 'favicon';
  label: string;
  hint: string;
  current: string | null;
  file: File | undefined;
  disabled: boolean;
  onFile: (f: File) => void;
}) {
  const t = useTranslations(NS);
  const id = useId();
  const [over, setOver] = useState(false);
  const preview = useMemo(
    () => (props.file ? URL.createObjectURL(props.file) : null),
    [props.file],
  );
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  const size = props.slot === 'logo' ? 'h-12 max-w-[140px]' : 'size-10';
  const shown = preview ?? props.current;
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f && !props.disabled) props.onFile(f);
  };
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold">{props.label}</div>
      <label
        htmlFor={id}
        data-dropzone={props.slot}
        onDragOver={(e) => {
          e.preventDefault();
          if (!props.disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'block rounded-xl border-2 border-dashed border-border p-6 text-center transition',
          props.disabled
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:border-primary hover:bg-muted/60',
          over && 'border-primary bg-muted/60',
        )}
      >
        <input
          id={id}
          type="file"
          name={props.slot}
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={props.disabled}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) props.onFile(f);
          }}
        />
        {shown && (
          <div className="mb-3">
            <img
              src={shown}
              alt={preview ? props.file!.name : t(`current.${props.slot}`)}
              className={cn(
                'mx-auto rounded border border-border bg-muted object-contain p-1',
                size,
              )}
            />
            <div className="mt-1.5 font-mono text-[10.5px] text-muted-foreground">
              {preview ? props.file!.name : t('currentTag')}
            </div>
          </div>
        )}
        <div className="mt-2 text-sm font-medium">
          <span className="text-primary">{t('click')}</span> {t('orDrag')}
        </div>
        <div className="mt-0.5 text-[10.5px] text-muted-foreground">{props.hint}</div>
      </label>
    </div>
  );
}
