'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { setGroupResponseSchema } from '@crm/contracts';
import { Alert, Button, Spinner } from '@crm/ui';
import { toApiError } from '@/lib/api/errors';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { assetLimitKb, validateAssetFile } from '../lib/asset-file';
import { groupKey, hubKey } from '../lib/query-keys';
import { LOGO_THEMES } from '../fields';

const NS = 'platform-settings-branding-storage.brandAssets';

/** A file picker with an instant local preview, an explicit upload and (once saved) a remove. */
export function AssetSlot({
  slot,
  url,
  canEdit,
  label,
  note,
  dark,
  onChanged,
}: {
  slot: string;
  url: string;
  canEdit: boolean;
  label: string;
  note: string;
  dark?: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations(NS);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // The local preview is an object URL made when a file is picked; it is released when replaced or on unmount.
  const pick = (next: File | null) => {
    setPreview(next ? URL.createObjectURL(next) : null);
    setFile(next);
  };
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const upload = useMutation({
    mutationFn: async (f: File) => {
      const body = new FormData();
      body.append('file', f);
      const res = await fetch(`/api/platform/settings/assets/${slot}`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { 'Idempotency-Key': crypto.randomUUID(), Accept: 'application/json' },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => undefined);
        throw toApiError(res.status, json, res.headers.get('x-request-id'));
      }
    },
    onSuccess: () => {
      pick(null);
      setError(null);
      if (input.current) input.current.value = '';
      onChanged();
    },
    onError: (e: Error & { fieldErrors?: Array<{ message: string }> }) =>
      setError(e.fieldErrors?.[0]?.message ?? t('failed')),
  });
  const remove = useMutation({
    mutationFn: () => operatorFetch(`/settings/assets/${slot}`, { method: 'DELETE' }),
    onSuccess: onChanged,
    onError: () => setError(t('failed')),
  });

  const shown = preview ?? url;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{label}</p>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {slot.replace('logo-', '')}
        </span>
      </div>
      <div
        className={`flex h-20 items-center justify-center rounded-md border border-dashed border-border ${dark ? 'bg-foreground' : 'bg-muted'}`}
      >
        {shown ? (
          <img src={shown} alt={label} className="max-h-16 max-w-full object-contain" />
        ) : (
          <span
            className={`font-mono text-[10px] uppercase tracking-wider ${dark ? 'text-background' : 'text-muted-foreground'}`}
          >
            {t('noFile')}
          </span>
        )}
      </div>
      {canEdit && (
        <div className="space-y-2">
          <input
            ref={input}
            type="file"
            aria-label={label}
            accept={
              slot === 'favicon' ? '.png,.ico,.jpg,.jpeg,.svg,.webp' : '.png,.jpg,.jpeg,.svg,.webp'
            }
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              const problem = f ? validateAssetFile(slot, f) : null;
              setError(problem ? t(problem, { kb: assetLimitKb(slot) }) : null);
              pick(problem ? null : f);
            }}
            className="block w-full text-xs file:me-2 file:rounded-md file:border file:border-border file:bg-background file:px-2 file:py-1 file:text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            {file && (
              <Button
                type="button"
                size="sm"
                onClick={() => upload.mutate(file)}
                disabled={upload.isPending}
              >
                {upload.isPending && <Spinner label={t('uploading')} />}
                {t('upload')}
              </Button>
            )}
            {url && !file && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                {t('remove')}
              </Button>
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/** The "Brand assets" card of the General page: one favicon and a logo per theme (WD-SET-010). */
export function BrandAssets({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations(NS);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: groupKey('branding'),
    queryFn: ({ signal }) =>
      operatorFetch('/settings/groups/branding', { schema: setGroupResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) return <Spinner label={t('loading')} />;
  if (q.isError) return <Alert tone="danger">{t('loadFailed')}</Alert>;
  const values = q.data.values as { faviconUrl: string; logos: Record<string, string> };
  const changed = () => {
    void qc.invalidateQueries({ queryKey: groupKey('branding') });
    void qc.invalidateQueries({ queryKey: hubKey });
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <AssetSlot
        slot="favicon"
        url={values.faviconUrl}
        canEdit={canEdit}
        label={t('favicon.title')}
        note={t('favicon.note')}
        onChanged={changed}
      />
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t('logos.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('logos.note')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {LOGO_THEMES.map((theme) => (
          <AssetSlot
            key={theme}
            slot={`logo-${theme}`}
            url={values.logos[theme] ?? ''}
            canEdit={canEdit}
            label={t(`themes.${theme}.label`)}
            note={t(`themes.${theme}.note`)}
            dark={theme === 'dark'}
            onChanged={changed}
          />
        ))}
      </div>
    </div>
  );
}
