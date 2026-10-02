'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { CurrencyItem, CurrencyListResponse, CurrencyOption } from '@crm/contracts';
import { CURRENCY_LIMITS } from '@crm/contracts';
import { Badge, Button, Card, Checkbox, Field, Input, Select, StatTile } from '@crm/ui';
import {
  type CurrencyDraft,
  type CurrencyProblems,
  emptyCurrencyDraft,
  normaliseCode,
  toEditDraft,
} from '../lib/form';
import { canDeleteRow, optionLabel, rateCell } from '../lib/table';

const NS = 'coupons-credits-referral-currency.currencies.admin';

/** Total, Active, System default (upper case) and Inactive. */
export function CurrencyKpis({ stats }: { stats: CurrencyListResponse['stats'] }) {
  const t = useTranslations(`${NS}.kpi`);
  return (
    <section
      aria-label={t('total')}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <StatTile label={t('total')} value={stats.total} hint={t('totalHint')} />
      <StatTile label={t('active')} value={stats.active} hint={t('activeHint')} tone="accent" />
      <StatTile
        label={t('default')}
        value={<span className="uppercase">{stats.defaultCode}</span>}
        hint={t('defaultHint')}
      />
      <StatTile label={t('inactive')} value={stats.inactive} hint={t('inactiveHint')} />
    </section>
  );
}

/** The platform-wide fallback: every ACTIVE currency, the current default preselected. */
export function DefaultCurrencyCard({
  options,
  defaultCode,
  canWrite,
  busy,
  onSet,
}: {
  options: readonly CurrencyOption[];
  defaultCode: string;
  canWrite: boolean;
  busy: boolean;
  onSet: (code: string) => void;
}) {
  const t = useTranslations(`${NS}.default`);
  const [code, setCode] = useState(defaultCode);
  return (
    <Card className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('eyebrow')}
        </p>
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('body')}</p>
      </div>
      <form
        className="flex shrink-0 flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canWrite) onSet(code);
        }}
      >
        <Select
          aria-label={t('label')}
          value={code}
          disabled={!canWrite || busy}
          onChange={(e) => setCode(e.target.value)}
          className="w-auto min-w-64 font-mono"
        >
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {optionLabel(o)}
            </option>
          ))}
        </Select>
        {canWrite && (
          <Button type="submit" disabled={busy || code === ''}>
            {t('set')}
          </Button>
        )}
      </form>
    </Card>
  );
}

/** The five editable fields in one grid: the add form (with the code) and the inline edit (code read-only). */
function CurrencyFields({
  draft,
  onChange,
  problems,
  idPrefix,
  codeLocked,
}: {
  draft: CurrencyDraft;
  onChange: (next: CurrencyDraft) => void;
  problems: CurrencyProblems;
  idPrefix: string;
  codeLocked: boolean;
}) {
  const t = useTranslations(`${NS}.form`);
  const te = useTranslations(`${NS}.form.errors`);
  const set = (patch: Partial<CurrencyDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={t('name')} htmlFor={`${idPrefix}-name`} error={problems.name && te('name')}>
        <Input
          id={`${idPrefix}-name`}
          value={draft.name}
          maxLength={CURRENCY_LIMITS.nameMax}
          required
          placeholder={t('namePlaceholder')}
          invalid={problems.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>
      <Field
        label={t('code')}
        htmlFor={`${idPrefix}-code`}
        error={problems.code && te(problems.codeTaken ? 'codeTaken' : 'code')}
      >
        <Input
          id={`${idPrefix}-code`}
          value={draft.code}
          maxLength={CURRENCY_LIMITS.codeMax}
          required
          readOnly={codeLocked}
          placeholder={t('codePlaceholder')}
          invalid={problems.code}
          className="font-mono uppercase"
          onChange={(e) => set({ code: normaliseCode(e.target.value) })}
        />
      </Field>
      <Field
        label={t('symbol')}
        htmlFor={`${idPrefix}-symbol`}
        error={problems.symbol && te('symbol')}
      >
        <Input
          id={`${idPrefix}-symbol`}
          value={draft.symbol}
          maxLength={CURRENCY_LIMITS.symbolMax}
          placeholder={t('symbolPlaceholder')}
          invalid={problems.symbol}
          onChange={(e) => set({ symbol: e.target.value })}
        />
      </Field>
      <Field
        label={t('precision')}
        htmlFor={`${idPrefix}-precision`}
        error={problems.precision && te('precision')}
      >
        <Input
          id={`${idPrefix}-precision`}
          type="number"
          inputMode="numeric"
          min={0}
          max={6}
          step={1}
          required
          value={draft.precision}
          invalid={problems.precision}
          className="font-mono"
          onChange={(e) => set({ precision: e.target.value })}
        />
      </Field>
      <Field
        label={t('rate')}
        htmlFor={`${idPrefix}-rate`}
        hint={codeLocked ? undefined : t('rateHint')}
        error={problems.exchangeRate && te('exchangeRate')}
        className="sm:col-span-2"
      >
        <Input
          id={`${idPrefix}-rate`}
          type="number"
          inputMode="decimal"
          min={0.000001}
          step={0.000001}
          required
          value={draft.exchangeRate}
          invalid={problems.exchangeRate}
          className="font-mono"
          onChange={(e) => set({ exchangeRate: e.target.value })}
        />
      </Field>
      <div className="sm:col-span-2 lg:col-span-3">
        <Checkbox
          id={`${idPrefix}-active`}
          label={t('active')}
          checked={draft.isActive}
          onChange={(e) => set({ isActive: e.target.checked })}
        />
      </div>
    </div>
  );
}

/** "Add a currency": hidden until the header button opens it. */
export function AddCurrencyForm({
  busy,
  problems,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  problems: CurrencyProblems;
  onSubmit: (draft: CurrencyDraft) => void;
  onCancel: () => void;
}) {
  const t = useTranslations(`${NS}.form`);
  const [draft, setDraft] = useState<CurrencyDraft>(emptyCurrencyDraft);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(draft);
  };
  return (
    <Card className="space-y-4">
      <form onSubmit={submit} noValidate className="space-y-4" aria-label={t('title')}>
        <div className="space-y-0.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('eyebrow')}
          </p>
          <h3 className="text-lg font-semibold">{t('title')}</h3>
        </div>
        <CurrencyFields
          draft={draft}
          onChange={setDraft}
          problems={problems}
          idPrefix="cur-add"
          codeLocked={false}
        />
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t('saving') : t('submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Inline edit of one row: name, symbol, decimals, rate and active. The code is shown and cannot change. */
export function EditCurrencyForm({
  item,
  busy,
  problems,
  stale,
  onSubmit,
  onCancel,
}: {
  item: CurrencyItem;
  busy: boolean;
  problems: CurrencyProblems;
  stale: boolean;
  onSubmit: (draft: CurrencyDraft) => void;
  onCancel: () => void;
}) {
  const t = useTranslations(`${NS}.editing`);
  const te = useTranslations(`${NS}.errors`);
  const [draft, setDraft] = useState<CurrencyDraft>(() => toEditDraft(item));
  return (
    <form
      noValidate
      aria-label={t('title', { code: item.code })}
      className="space-y-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      <div>
        <h3 className="font-semibold">{t('title', { code: item.code })}</h3>
        <p className="text-xs text-muted-foreground">{t('codeNote')}</p>
      </div>
      {stale && (
        <p role="alert" className="text-sm text-danger">
          {te('conflict')}
        </p>
      )}
      <CurrencyFields
        draft={draft}
        onChange={setDraft}
        problems={problems}
        idPrefix={`cur-edit-${item.id}`}
        codeLocked
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}

const COLS = 7;

/** The catalog table. Write controls (On/Off, Edit, Delete) exist only for a super admin; the default row has no Delete. */
export function CurrencyTable({
  rows,
  q,
  canWrite,
  busyId,
  renderEditor,
  editingId,
  onToggle,
  onEdit,
  onDelete,
}: {
  rows: readonly CurrencyItem[];
  q: string;
  canWrite: boolean;
  busyId: string | null;
  editingId: string | null;
  renderEditor: (item: CurrencyItem) => React.ReactNode;
  onToggle: (c: CurrencyItem) => void;
  onEdit: (c: CurrencyItem) => void;
  onDelete: (c: CurrencyItem) => void;
}) {
  const t = useTranslations(NS);
  const tc = useTranslations(`${NS}.columns`);
  const th = 'px-4 py-2.5 font-medium';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm" aria-label={t('catalog.tableLabel')}>
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th scope="col" className={`${th} text-start`}>
              {tc('code')}
            </th>
            <th scope="col" className={`${th} text-start`}>
              {tc('name')}
            </th>
            <th scope="col" className={`${th} text-start`}>
              {tc('symbol')}
            </th>
            <th scope="col" className={`${th} text-end`}>
              {tc('rate')}
            </th>
            <th scope="col" className={`${th} text-center`}>
              {tc('precision')}
            </th>
            <th scope="col" className={`${th} text-center`}>
              {tc('active')}
            </th>
            <th scope="col" className={`${th} text-end`}>
              <span className={canWrite ? undefined : 'sr-only'}>{tc('actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={COLS} className="px-4 py-10 text-center text-muted-foreground">
                {q ? t('empty.search', { q }) : t('empty.none')}
              </td>
            </tr>
          ) : (
            rows.map((c) => (
              <CurrencyRow
                key={c.id}
                c={c}
                canWrite={canWrite}
                busy={busyId === c.id}
                editing={editingId === c.id}
                editor={editingId === c.id ? renderEditor(c) : null}
                onToggle={onToggle}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function CurrencyRow({
  c,
  canWrite,
  busy,
  editing,
  editor,
  onToggle,
  onEdit,
  onDelete,
}: {
  c: CurrencyItem;
  canWrite: boolean;
  busy: boolean;
  editing: boolean;
  editor: React.ReactNode;
  onToggle: (c: CurrencyItem) => void;
  onEdit: (c: CurrencyItem) => void;
  onDelete: (c: CurrencyItem) => void;
}) {
  const t = useTranslations(NS);
  const pill = c.isActive
    ? 'border-success/40 bg-success/15 text-success'
    : 'border-border bg-muted text-muted-foreground';
  return (
    <>
      <tr className="hover:bg-muted/30">
        <td className="whitespace-nowrap px-4 py-2.5 font-mono font-semibold">
          {c.code}
          {c.isDefault && (
            <Badge tone="success" className="ms-1.5 align-middle uppercase">
              {t('defaultBadge')}
            </Badge>
          )}
        </td>
        <td className="px-4 py-2.5">{c.name}</td>
        <td className="px-4 py-2.5">{c.symbol}</td>
        <td className="px-4 py-2.5 text-end font-mono tabular-nums">{rateCell(c.exchangeRate)}</td>
        <td className="px-4 py-2.5 text-center font-mono">{c.precision}</td>
        <td className="px-4 py-2.5 text-center">
          {canWrite ? (
            <button
              type="button"
              disabled={busy}
              aria-pressed={c.isActive}
              aria-label={t(c.isActive ? 'toggleOn' : 'toggleOff', { code: c.code })}
              onClick={() => onToggle(c)}
              className={`rounded-full border px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 ${pill}`}
            >
              {t(c.isActive ? 'on' : 'off')}
            </button>
          ) : (
            <span className={`rounded-full border px-2.5 py-1 font-mono text-xs ${pill}`}>
              {t(c.isActive ? 'on' : 'off')}
            </span>
          )}
        </td>
        <td className="px-4 py-2.5 text-end">
          {canWrite && (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={editing}
                aria-label={`${t('edit')}: ${c.code}`}
                onClick={() => onEdit(c)}
              >
                {t('edit')}
              </Button>
              {canDeleteRow(c, canWrite) && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`${t('delete')}: ${c.code}`}
                  onClick={() => onDelete(c)}
                  className="text-danger"
                >
                  {t('delete')}
                </Button>
              )}
            </div>
          )}
        </td>
      </tr>
      {editing && (
        <tr className="bg-muted/20">
          <td colSpan={COLS}>{editor}</td>
        </tr>
      )}
    </>
  );
}
