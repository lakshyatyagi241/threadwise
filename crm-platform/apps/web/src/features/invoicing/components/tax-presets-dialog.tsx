'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { TAX_PROFILES } from '@crm/tax';
import type { ApplyTaxPresetsResponse, TaxPresetRow } from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  Modal,
  Select,
  Spinner,
  Switch,
  useToast,
} from '@crm/ui';
import { invalidateInvoicing, useInvoiceSettings, useTaxPresets } from '../api/hooks';
import { invoicingApi } from '../api/service';
import { formatDay } from '../lib/dates';
import { percentLabel } from '../lib/wire';
import { codesToApply, defaultPicked, inForce, pickedHasDefault } from '../lib/tax-presets';
import { ErrorLine, useErrorText } from './parts';

const COUNTRIES = [...TAX_PROFILES]
  .filter((p) => /^[A-Z]{2}$/.test(p.code))
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * "Load rates for my country": a country's tax rates from the tax engine, ready to tick and add. They are defaults compiled from
 * public sources, never tax advice: the notes and the disclaimer are shown before anything is applied, and applying twice adds
 * nothing new (rates that already exist are skipped).
 */
export function TaxPresetsDialog({
  country,
  onClose,
  onApplied,
}: {
  country?: string | null;
  onClose: () => void;
  onApplied?: (r: ApplyTaxPresetsResponse) => void;
}) {
  const settings = useInvoiceSettings();
  const initial = (country ?? settings.data?.sellerCountry ?? '').toUpperCase();
  // The person's own choice wins; until they pick, the country follows the prop, then the business profile once it has loaded.
  const [chosen, setChosen] = useState<string | null>(null);
  const code = chosen ?? initial;
  return (
    <Body key={code} code={code} onChoose={setChosen} onClose={onClose} onApplied={onApplied} />
  );
}

function Body({
  code,
  onChoose,
  onClose,
  onApplied,
}: {
  code: string;
  onChoose: (c: string) => void;
  onClose: () => void;
  onApplied?: (r: ApplyTaxPresetsResponse) => void;
}) {
  const t = useTranslations('invoicing.taxRates.presets');
  const tt = useTranslations('invoicing.taxRates.types');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const presets = useTaxPresets(code || null);
  const data = presets.data;
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [setDefault, setSetDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyTaxPresetsResponse | null>(null);

  const rows = data?.data ?? [];
  const asOf = data?.asOf ?? '';
  const selection = picked ?? (data ? defaultPicked(rows, asOf) : new Set<string>());
  const codes = codesToApply(rows, selection);
  const hasDefault = pickedHasDefault(rows, selection);

  const toggle = (c: string) => {
    const next = new Set(selection);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setPicked(next);
  };

  async function apply() {
    if (codes.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await invoicingApi.applyTaxPresets({
        country: code,
        codes,
        setDefault: setDefault && hasDefault,
      });
      await invalidateInvoicing(qc);
      setResult(r);
      toast(t('applied', { created: r.created.length }));
      onApplied?.(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={t('eyebrow')}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        result ? (
          <Button variant="brand" onClick={onClose}>
            {t('done')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button
              variant="brand"
              onClick={() => void apply()}
              disabled={busy || codes.length === 0}
            >
              {busy && <Spinner />}
              {t('apply', { count: codes.length })}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <Field label={t('country')} htmlFor="preset-country">
          <Select
            id="preset-country"
            value={code}
            onChange={(e) => onChoose(e.target.value)}
            disabled={busy || result !== null}
          >
            <option value="">{t('pickCountry')}</option>
            {code && !COUNTRIES.some((c) => c.code === code) && (
              <option value={code}>{code}</option>
            )}
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </Select>
        </Field>

        {result ? (
          <div className="space-y-3" role="status">
            <Alert tone={result.created.length > 0 ? 'success' : 'info'}>
              <span className="font-medium">
                {t('result', { created: result.created.length, skipped: result.skipped.length })}
              </span>
            </Alert>
            {result.skipped.length > 0 && (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {result.skipped.map((s) => (
                  <li key={s.name} dir="auto">
                    {s.name}: {s.reason}
                  </li>
                ))}
              </ul>
            )}
            {data && <Disclaimer notes={data.notes} disclaimer={data.disclaimer} />}
          </div>
        ) : !code ? (
          <p className="text-sm text-muted-foreground">{t('chooseHint')}</p>
        ) : presets.isPending ? (
          <div role="status" className="flex items-center gap-2 py-4 text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : presets.isError ? (
          <ErrorLine error={presets.error} onRetry={() => void presets.refetch()} />
        ) : (
          <>
            {data && <Disclaimer notes={data.notes} disclaimer={data.disclaimer} />}
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('noRates', { country: data?.countryName ?? code })}
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {t('asOf', {
                      country: data?.countryName ?? code,
                      date: formatDay(asOf, locale),
                    })}
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      className="hover:text-foreground hover:underline"
                      onClick={() => setPicked(defaultPicked(rows, asOf))}
                    >
                      {t('selectRecommended')}
                    </button>
                    <button
                      type="button"
                      className="hover:text-foreground hover:underline"
                      onClick={() => setPicked(new Set())}
                    >
                      {t('selectNone')}
                    </button>
                  </span>
                </div>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {rows.map((r) => (
                    <PresetRow
                      key={r.code}
                      row={r}
                      asOf={asOf}
                      checked={selection.has(r.code)}
                      onToggle={() => toggle(r.code)}
                      typeLabel={tt(r.type)}
                    />
                  ))}
                </ul>
                <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <span>
                    <span className="block font-medium">{t('setDefault')}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t('setDefaultHint')}
                    </span>
                  </span>
                  <Switch
                    checked={setDefault && hasDefault}
                    onCheckedChange={setSetDefault}
                    label={t('setDefault')}
                    disabled={!hasDefault}
                  />
                </label>
              </div>
            )}
          </>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

function Disclaimer({ notes, disclaimer }: { notes: readonly string[]; disclaimer: string }) {
  const t = useTranslations('invoicing.taxRates.presets');
  return (
    <Alert tone="warning">
      <span className="block font-semibold">{t('verify')}</span>
      <span className="mt-1 block" dir="auto">
        {disclaimer}
      </span>
      {notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 ps-5 text-sm" dir="auto">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

function PresetRow({
  row,
  asOf,
  checked,
  onToggle,
  typeLabel,
}: {
  row: TaxPresetRow;
  asOf: string;
  checked: boolean;
  onToggle: () => void;
  typeLabel: string;
}) {
  const t = useTranslations('invoicing.taxRates.presets');
  const locale = useLocale();
  const active = inForce(row, asOf);
  return (
    <li className="px-3 py-2.5">
      <Checkbox
        id={`preset-${row.code}`}
        checked={checked && !row.exists}
        disabled={row.exists}
        onChange={onToggle}
        label={
          <span className="block min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium" dir="auto">
                {row.name}
              </span>
              <span dir="ltr" className="tabular-nums font-semibold">
                {percentLabel(row.rate)}%
              </span>
              {row.isDefault && <Badge tone="success">{t('standard')}</Badge>}
              {row.exists && <Badge tone="neutral">{t('exists')}</Badge>}
              {!active && !row.exists && <Badge tone="warning">{t('notInForce')}</Badge>}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {typeLabel} - {row.inclusive ? t('inclusive') : t('exclusive')}
              {row.region ? ` - ${row.region}` : ''} -{' '}
              {t('from', { date: formatDay(row.effectiveFrom, locale) })}
              {row.effectiveTo
                ? ` - ${t('until', { date: formatDay(row.effectiveTo, locale) })}`
                : ''}
            </span>
            {row.components && row.components.length > 0 && (
              <span dir="ltr" className="mt-0.5 block text-xs text-muted-foreground">
                {row.components.map((c) => `${c.type} ${percentLabel(c.rate)}%`).join(' + ')}
              </span>
            )}
            {row.description && (
              <span className="mt-0.5 block text-xs text-muted-foreground" dir="auto">
                {row.description}
              </span>
            )}
          </span>
        }
      />
    </li>
  );
}
