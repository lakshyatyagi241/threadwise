'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, ConfirmDialog, Field, Input, Switch, cn } from '@crm/ui';
import {
  OPTION_NAME_MAX,
  OPTION_VALUE_MAX,
  PRODUCT_PRICE_MAX,
  formatProductMoney,
} from '@crm/contracts';
import {
  MAX_OPTIONS,
  OPTION_NAME_SUGGESTIONS,
  PRESET_KEYS,
  VALUE_PRESETS,
  addValue,
  addValues,
  bulkFill,
  fromPrice,
  move,
  regenerateRows,
  droppedWithData,
  rowTitle,
  stockTotal,
  variantPathOf,
  withPreset,
  type OptionDraft,
  type PresetKey,
  type Regenerated,
  type RowProblems,
  type VariantProblem,
  type VariantProblems,
  type VariantRow,
  type VariantsState,
} from '../lib/variants-model';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, PlusIcon } from './icons';
import { CARD, KICKER } from './parts';

const LABEL = 'font-semibold';
const MONO = 'font-mono text-[12.5px]';
const ICON_BTN =
  'grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40';

type ServerErrors = Record<string, string>;

/**
 * The Variants section of the product form (an owner-approved extension; Reference has no variants): a switch, up to three
 * options with their values as chips, the generated variant table with per-row SKU, price, stock, image and active switch, a
 * bulk fill and the stock total. All state lives in the form (`state`); this component only edits it.
 */
export function VariantsSection({
  state,
  onChange,
  problems,
  serverErrors,
  hadVariants,
  productPriceMajor,
  currencyCode,
}: {
  state: VariantsState;
  onChange: (next: VariantsState) => void;
  /** Contract checks, passed once the form was submitted. */
  problems: VariantProblems | null;
  /** The API's field errors by path (`variants.2.priceMajor`). */
  serverErrors: ServerErrors;
  /** The product being edited has variants stored: turning the switch off removes them on save. */
  hadVariants: boolean;
  productPriceMajor: string;
  currencyCode: string;
}) {
  const t = useTranslations('catalogProducts.form.variants');
  const [pending, setPending] = useState<{ options: OptionDraft[]; result: Regenerated } | null>(
    null,
  );
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkStock, setBulkStock] = useState('');
  const [focusOption, setFocusOption] = useState<number | null>(null);

  const problemText = (p: VariantProblem | undefined, server: string | undefined) =>
    p ? t(`problem.${p}`) : server;

  // Server errors keyed by where they belong.
  const server = {
    general: undefined as string | undefined,
    options: {} as Record<number, { name?: string; values?: string }>,
    rows: {} as Record<number, Partial<Record<keyof RowProblems | 'other', string>>>,
  };
  for (const [path, message] of Object.entries(serverErrors)) {
    const at = variantPathOf(path);
    if (!at) continue;
    if (at.kind === 'general') server.general ??= message;
    else if (at.kind === 'option') {
      const o = (server.options[at.index] ??= {});
      o[at.field] ??= message;
    } else {
      const r = (server.rows[at.index] ??= {});
      r[at.field] ??= message;
    }
  }

  const applyOptions = (nextOptions: OptionDraft[]) => {
    const result = regenerateRows(state.options, state.rows, nextOptions);
    if (droppedWithData(result).length > 0) setPending({ options: nextOptions, result });
    else onChange({ ...state, options: nextOptions, rows: result.rows });
  };
  const setOption = (i: number, patch: Partial<OptionDraft>) =>
    applyOptions(state.options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const setRow = (i: number, patch: Partial<VariantRow>) =>
    onChange({ ...state, rows: state.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const toggle = (on: boolean) => {
    if (on && state.options.length === 0) {
      setFocusOption(0);
      onChange({ ...state, enabled: true, options: [{ name: '', values: [] }] });
    } else onChange({ ...state, enabled: on });
  };

  const addOption = () => {
    setFocusOption(state.options.length);
    applyOptions([...state.options, { name: '', values: [] }]);
  };

  const total = stockTotal(state.rows);
  const low = fromPrice(state.rows, productPriceMajor);
  const complete = state.options.length > 0 && state.options.every((o) => o.values.length > 0);
  const lostCount = pending ? droppedWithData(pending.result).length : 0;

  return (
    <section className={`${CARD} p-5`} aria-labelledby="cat-form-variants">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="cat-form-variants" className={`${KICKER} font-normal`}>
            {t('title')}
          </h2>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t('hint')}</p>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] font-semibold">
          <Switch
            id="cat-p-hasvariants"
            checked={state.enabled}
            onCheckedChange={toggle}
            label={t('toggle')}
          />
          <span>{t('toggle')}</span>
        </label>
      </div>

      {!state.enabled && hadVariants && (
        <Alert tone="warning" className="mt-3 text-[12px]">
          {t('removeOnSave')}
        </Alert>
      )}

      {state.enabled && (
        <div className="mt-4 space-y-5">
          {(problems?.general || server.general) && (
            <p role="alert" className="text-xs text-danger">
              {problemText(problems?.general, server.general)}
            </p>
          )}

          <ol className="space-y-3">
            {state.options.map((o, i) => (
              <OptionEditor
                key={i}
                index={i}
                option={o}
                count={state.options.length}
                autoFocusName={focusOption === i}
                nameError={problemText(problems?.options[i]?.name, server.options[i]?.name)}
                valuesError={problemText(problems?.options[i]?.values, server.options[i]?.values)}
                onChange={(patch) => setOption(i, patch)}
                onRemove={() => applyOptions(state.options.filter((_, j) => j !== i))}
                onMove={(to) => applyOptions(move(state.options, i, to))}
              />
            ))}
          </ol>

          <Button
            variant="secondary"
            size="sm"
            className="rounded-full text-[11.5px]"
            disabled={state.options.length >= MAX_OPTIONS}
            onClick={addOption}
          >
            <PlusIcon className="size-3" strokeWidth={1.8} />
            {t('addOption')}
          </Button>
          {state.options.length >= MAX_OPTIONS && (
            <span className="ms-2 text-[11px] text-muted-foreground">
              {t('maxOptions', { max: MAX_OPTIONS })}
            </span>
          )}

          {complete ? (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className={`${KICKER} font-normal`}>
                  {t('tableTitle')}{' '}
                  <Badge className="ms-1 font-mono text-[10.5px]" data-testid="variant-count">
                    {t('count', { count: state.rows.length })}
                  </Badge>
                </h3>
                <p className="text-[12px]" data-testid="variant-summary">
                  <span className="text-muted-foreground">{t('totalStock')}: </span>
                  <strong className="tabular-nums">
                    {total.unlimited ? t('unlimited') : total.total}
                  </strong>
                  {low !== null && (
                    <>
                      <span className="mx-2 text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{t('fromPrice')}: </span>
                      <strong className="tabular-nums">
                        {formatProductMoney(Math.round(low * 100), currencyCode)}
                      </strong>
                    </>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <BulkBox
                  id="cat-v-bulk-price"
                  label={t('bulkPrice')}
                  value={bulkPrice}
                  placeholder={t('pricePlaceholder')}
                  action={t('bulkApplyPrice')}
                  step="0.01"
                  max={PRODUCT_PRICE_MAX}
                  onValue={setBulkPrice}
                  onApply={() =>
                    onChange({ ...state, rows: bulkFill(state.rows, { priceMajor: bulkPrice }) })
                  }
                />
                <BulkBox
                  id="cat-v-bulk-stock"
                  label={t('bulkStock')}
                  value={bulkStock}
                  placeholder={t('stockPlaceholder')}
                  action={t('bulkApplyStock')}
                  step="1"
                  max={1_000_000}
                  onValue={setBulkStock}
                  onApply={() =>
                    onChange({ ...state, rows: bulkFill(state.rows, { stockQty: bulkStock }) })
                  }
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-[12.5px]">
                  <thead className="border-b border-border bg-muted text-start text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {t('col.variant')}
                      </th>
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {t('col.sku')}
                      </th>
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {t('col.price')}
                      </th>
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {t('col.stock')}
                      </th>
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {t('col.image')}
                      </th>
                      <th scope="col" className="px-2 py-2 text-center font-medium">
                        {t('col.active')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {state.rows.map((r, i) => {
                      const title = rowTitle(r);
                      const err = (f: keyof RowProblems) =>
                        problemText(problems?.rows[i]?.[f], server.rows[i]?.[f]);
                      return (
                        <tr key={title} className={cn(!r.active && 'opacity-60')}>
                          <th
                            scope="row"
                            className="whitespace-nowrap px-2 py-2 text-start font-medium"
                          >
                            {title}
                          </th>
                          <td className="px-2 py-2 align-top">
                            <CellInput
                              value={r.sku}
                              label={t('rowSku', { title })}
                              error={err('sku')}
                              maxLength={96}
                              className={MONO}
                              onChange={(v) => setRow(i, { sku: v })}
                            />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <CellInput
                              value={r.priceMajor}
                              label={t('rowPrice', { title })}
                              error={err('priceMajor')}
                              type="number"
                              min={0}
                              step="0.01"
                              inputMode="decimal"
                              placeholder={productPriceMajor.trim() || t('pricePlaceholder')}
                              className={MONO}
                              onChange={(v) => setRow(i, { priceMajor: v })}
                            />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <CellInput
                              value={r.stockQty}
                              label={t('rowStock', { title })}
                              error={err('stockQty')}
                              type="number"
                              min={0}
                              max={1_000_000}
                              placeholder={t('stockPlaceholder')}
                              className={MONO}
                              onChange={(v) => setRow(i, { stockQty: v })}
                            />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <CellInput
                              value={r.imageUrl}
                              label={t('rowImage', { title })}
                              error={err('imageUrl')}
                              type="url"
                              maxLength={1024}
                              placeholder="https://..."
                              className={cn(MONO, 'min-w-[160px]')}
                              onChange={(v) => setRow(i, { imageUrl: v })}
                            />
                          </td>
                          <td className="px-2 py-2 text-center align-top">
                            <div className="grid h-10 place-items-center">
                              <Switch
                                checked={r.active}
                                onCheckedChange={(on) => setRow(i, { active: on })}
                                label={t('rowActive', { title })}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {server.rows && Object.values(server.rows).some((r) => r.other) && (
                <p role="alert" className="text-xs text-danger">
                  {Object.values(server.rows).find((r) => r.other)?.other}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[11.5px] italic text-muted-foreground">{t('tableEmpty')}</p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={t('confirm.title')}
        message={t('confirm.body', { count: lostCount })}
        confirmLabel={t('confirm.remove')}
        cancelLabel={t('confirm.keep')}
        tone="danger"
        onConfirm={() => {
          if (pending) onChange({ ...state, options: pending.options, rows: pending.result.rows });
          setPending(null);
        }}
        onClose={() => setPending(null)}
      />
    </section>
  );
}

function CellInput({
  value,
  label,
  error,
  onChange,
  className,
  ...rest
}: {
  value: string;
  label: string;
  error?: string;
  onChange: (value: string) => void;
  className?: string;
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'className'>) {
  return (
    <div>
      <Input
        {...rest}
        value={value}
        aria-label={label}
        invalid={Boolean(error)}
        className={cn('h-9', className)}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function BulkBox({
  id,
  label,
  value,
  placeholder,
  action,
  step,
  max,
  onValue,
  onApply,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  action: string;
  step: string;
  max: number;
  onValue: (v: string) => void;
  onApply: () => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <Field label={<span className="text-[11.5px] font-semibold">{label}</span>} htmlFor={id}>
        <Input
          id={id}
          type="number"
          min={0}
          max={max}
          step={step}
          value={value}
          placeholder={placeholder}
          className={cn('h-9 w-32', MONO)}
          onChange={(e) => onValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onApply();
            }
          }}
        />
      </Field>
      <Button
        size="sm"
        variant="secondary"
        className="h-9 rounded-full text-[11.5px]"
        onClick={onApply}
      >
        {action}
      </Button>
    </div>
  );
}

function OptionEditor({
  index,
  option,
  count,
  autoFocusName,
  nameError,
  valuesError,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  option: OptionDraft;
  count: number;
  autoFocusName: boolean;
  nameError?: string;
  valuesError?: string;
  onChange: (patch: Partial<OptionDraft>) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}) {
  const t = useTranslations('catalogProducts.form.variants');
  const [draft, setDraft] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const n = index + 1;
  const listId = `cat-v-names-${index}`;
  const valuesId = `cat-v-values-${index}`;

  const commit = (raw: string) => {
    const r = addValue(option.values, raw);
    if (r.ok) {
      setRefused(null);
      onChange({ values: r.values });
    } else if (r.reason !== 'empty') setRefused(t(`refused.${r.reason}`));
    setDraft('');
  };
  const removeValue = (v: number) => onChange({ values: option.values.filter((_, j) => j !== v) });
  const preset = (key: PresetKey) => {
    const values = withPreset(option.values, key);
    onChange({
      values,
      ...(option.name.trim() ? {} : { name: t('suggest.size') }),
    });
  };

  return (
    <li className="rounded-xl border border-border p-3" data-testid={`variant-option-${index}`}>
      <div className="flex items-start gap-2">
        <Field
          className="min-w-0 flex-1"
          label={
            <span className={LABEL}>
              {t('optionName', { n })} <span className="text-danger">*</span>
            </span>
          }
          htmlFor={`cat-v-name-${index}`}
          error={nameError}
        >
          <Input
            id={`cat-v-name-${index}`}
            value={option.name}
            maxLength={OPTION_NAME_MAX}
            list={listId}
            placeholder={t('optionNamePlaceholder')}
            invalid={Boolean(nameError)}
            autoFocus={autoFocusName}
            onChange={(e) => onChange({ name: e.target.value })}
          />
          <datalist id={listId}>
            {OPTION_NAME_SUGGESTIONS.map((s) => (
              <option key={s} value={t(`suggest.${s}`)} />
            ))}
          </datalist>
        </Field>
        <div className="mt-6 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className={ICON_BTN}
            aria-label={t('moveOptionUp', { n })}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            <ChevronRightIcon className="size-3.5 -rotate-90" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className={ICON_BTN}
            aria-label={t('moveOptionDown', { n })}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            <ChevronRightIcon className="size-3.5 rotate-90" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className={cn(ICON_BTN, 'hover:bg-danger/10 hover:text-danger')}
            aria-label={t('removeOption', { n })}
            onClick={onRemove}
          >
            <CloseIcon className="size-3" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <Field
        className="mt-3"
        label={<span className={LABEL}>{t('values')}</span>}
        htmlFor={valuesId}
        hint={t('valuesHint', { max: OPTION_VALUE_MAX })}
        error={refused ?? valuesError}
      >
        <div
          className={cn(
            'flex flex-wrap items-center gap-1.5 rounded-md border bg-background p-1.5',
            valuesError || refused ? 'border-danger' : 'border-border',
          )}
        >
          {option.values.map((v, j) => (
            <span
              key={v}
              data-testid="variant-chip"
              className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted ps-3 pe-1 text-[12px]"
            >
              {v}
              <button
                type="button"
                className={ICON_BTN}
                aria-label={t('moveValueEarlier', { value: v })}
                disabled={j === 0}
                onClick={() => onChange({ values: move(option.values, j, j - 1) })}
              >
                <ChevronLeftIcon className="size-3 rtl:-scale-x-100" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className={ICON_BTN}
                aria-label={t('moveValueLater', { value: v })}
                disabled={j === option.values.length - 1}
                onClick={() => onChange({ values: move(option.values, j, j + 1) })}
              >
                <ChevronRightIcon className="size-3 rtl:-scale-x-100" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className={cn(ICON_BTN, 'hover:bg-danger/10 hover:text-danger')}
                aria-label={t('removeValue', { value: v })}
                onClick={() => removeValue(j)}
              >
                <CloseIcon className="size-3" strokeWidth={1.8} />
              </button>
            </span>
          ))}
          <input
            id={valuesId}
            value={draft}
            maxLength={OPTION_VALUE_MAX * 4}
            placeholder={option.values.length === 0 ? t('valuesPlaceholder') : t('valuesMore')}
            aria-invalid={Boolean(valuesError || refused) || undefined}
            className="h-8 min-w-[10rem] flex-1 bg-transparent px-2 text-sm outline-none"
            onChange={(e) => {
              const v = e.target.value;
              if (v.includes(',')) {
                // typed or pasted "S, M, L": every part becomes a chip
                setRefused(null);
                onChange({ values: addValues(option.values, v) });
                setDraft('');
              } else {
                setRefused(null);
                setDraft(v);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // never submits the product form from here
                e.preventDefault();
                commit(draft);
              } else if (e.key === 'Backspace' && draft === '' && option.values.length > 0) {
                removeValue(option.values.length - 1);
              }
            }}
            onBlur={() => {
              if (draft.trim()) commit(draft);
            }}
          />
        </div>
      </Field>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">{t('quickAdd')}</span>
        {PRESET_KEYS.map((key) => (
          <Button
            key={key}
            size="sm"
            variant="secondary"
            className="h-7 rounded-full px-3 text-[11px]"
            onClick={() => preset(key)}
          >
            {key === 'clothing'
              ? t('preset.clothing', { values: VALUE_PRESETS[key].join(' ') })
              : t('preset.shoes', { values: VALUE_PRESETS[key].join(' ') })}
          </Button>
        ))}
      </div>
    </li>
  );
}
