'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { WarmerNumber } from '@crm/contracts';
import { Button, Checkbox, Field, Input, Spinner, StatTile, Switch, useToast, cn } from '@crm/ui';
import { KEYS, useWarmer, warmerApi } from '../api/schedules';
import {
  FIELD_BOUNDS,
  NUMBER_FIELDS,
  engineOf,
  formToProfile,
  healthTone,
  profileToForm,
  rollup,
  type NumberField,
  type WarmerForm,
} from '../lib/warmer-model';
import { ErrorNotice } from './error-notice';
import { useErrorText } from './use-error-text';

const fmt = (n: number) => n.toLocaleString('en-US');

const TONE = {
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
} as const;

/**
 * `/warmer` (TW-SCHED-008 to 012): the identity and "how it works" rail, the four tiles and one card per connected number with its
 * warming switch, today's budget, the ramp, gap and active-hour settings, the spintax switch and Save.
 */
export function WarmerScreen() {
  const t = useTranslations('scheduled-queue-warmer.warmer');
  const q = useWarmer();
  const errorText = useErrorText();
  const items = q.data?.items ?? [];
  const r = rollup(items);

  return (
    <div className="mx-auto grid max-w-[1300px] gap-6 p-4 sm:p-6 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-4">
        <div className="rounded-md border border-border bg-background p-4">
          <span className="rounded-full bg-brand/10 px-2.5 py-1 font-mono text-[11px] font-medium text-brand">
            {t('warming', { n: r.warming })}
          </span>
          <div className="mt-3 text-lg font-semibold">{t('name')}</div>
          <div className="text-xs text-muted-foreground">{t('tagline')}</div>
        </div>
        <div className="rounded-md border border-border bg-background p-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('how.title')}
          </div>
          <ol className="space-y-2">
            {(['one', 'two', 'three', 'four'] as const).map((k, i) => (
              <li key={k} className="flex gap-2 text-xs">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand/10 text-[10px] font-semibold text-brand">
                  {i + 1}
                </span>
                <span>{t(`how.${k}`)}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-md border border-warning/40 bg-warning/10 p-4 text-xs leading-relaxed">
          <div className="mb-1 font-semibold">{t('good.title')}</div>
          {t('good.body')}
        </div>
      </aside>

      <section className="min-w-0 space-y-5">
        <div>
          <div className="text-xs text-muted-foreground">{t('crumb')}</div>
          <h1 className="text-2xl font-semibold">{t('heading')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('lead')}</p>
        </div>

        {q.isError && <ErrorNotice error={errorText(q.error)} />}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label={t('tiles.warming')}
            value={r.warming}
            hint={t('tiles.warmingHint', { n: r.connected })}
          />
          <StatTile label={t('tiles.budget')} value={fmt(r.budget)} hint={t('tiles.budgetHint')} />
          <StatTile label={t('tiles.sent')} value={fmt(r.sent)} hint={t('tiles.sentHint')} />
          <StatTile label={t('tiles.health')} value={r.avgHealth} hint={t('tiles.healthHint')} />
        </div>

        {q.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
            <Link
              href="/channels/whatsapp"
              className="mt-3 inline-block text-sm font-semibold text-brand"
            >
              {t('connect')}
            </Link>
          </div>
        ) : (
          items.map((n) => <NumberCard key={n.key} n={n} />)
        )}
      </section>
    </div>
  );
}

function NumberCard({ n }: { n: WarmerNumber }) {
  const t = useTranslations('scheduled-queue-warmer.warmer');
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const [form, setForm] = useState<WarmerForm>(() => profileToForm(n.profile));
  const [errors, setErrors] = useState<Partial<Record<NumberField, string>>>({});
  const [failure, setFailure] = useState<ReturnType<typeof errorText> | null>(null);
  const [busy, setBusy] = useState(false);
  const tone = healthTone(n.health);
  const engine = engineOf(n.engine);

  const save = async () => {
    const r = formToProfile(form);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    setFailure(null);
    setBusy(true);
    try {
      const saved = await warmerApi.save(n.key, r.value);
      setForm(profileToForm(saved.profile));
      toast(t('saved'), 'success');
      await qc.invalidateQueries({ queryKey: KEYS.warmer });
    } catch (e) {
      const x = errorText(e);
      setFailure(x);
      const fe: Partial<Record<NumberField, string>> = {};
      for (const f of x.fieldErrors) {
        if ((NUMBER_FIELDS as readonly string[]).includes(f.path))
          fe[f.path as NumberField] = f.message;
      }
      setErrors(fe);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="rounded-md border border-border bg-background"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-warmer-key={n.key}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base font-semibold">{n.label || t('number')}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium">
              {t(`engines.${engine}`)}
            </span>
            <span
              className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', TONE[tone])}
              title={t('healthTitle')}
            >
              {t('health', { n: n.health })}
            </span>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            {n.phone ?? '—'} · {n.status}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>{t('switch')}</span>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            label={`${t('switch')} ${n.label}`}
          />
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-3">
          {[
            [t('budgetToday'), n.budget],
            [t('remaining'), n.remaining],
            [t('sentToday'), n.sentToday],
          ].map(([label, v]) => (
            <div key={label as string} className="rounded-lg bg-muted/50 p-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div className="text-xl font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {NUMBER_FIELDS.map((f) => (
            <Field
              key={f}
              label={t(`fields.${f}`)}
              htmlFor={`${n.key}-${f}`}
              hint={t(`hints.${f}`)}
              error={errors[f]}
            >
              <Input
                id={`${n.key}-${f}`}
                type="number"
                required
                min={FIELD_BOUNDS[f].min}
                max={FIELD_BOUNDS[f].max}
                value={form[f]}
                invalid={!!errors[f]}
                onChange={(e) => setForm({ ...form, [f]: e.target.value })}
              />
            </Field>
          ))}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <Checkbox
            id={`${n.key}-spintax`}
            checked={form.spintax}
            onChange={(e) => setForm({ ...form, spintax: e.target.checked })}
            label={
              <span>
                <span className="block font-medium">{t('spintax.title')}</span>
                <span className="block max-w-xl text-xs text-muted-foreground">
                  {t('spintax.hint')}
                </span>
              </span>
            }
          />
          <Button type="submit" variant="brand" disabled={busy}>
            {busy && <Spinner />}
            {t('save')}
          </Button>
        </div>
        {failure && <ErrorNotice error={failure} />}
      </div>
    </form>
  );
}
