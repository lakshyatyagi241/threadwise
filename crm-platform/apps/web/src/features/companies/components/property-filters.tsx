'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CompanyPropertyFilter } from '@crm/contracts';
import { Button, Popover, Select } from '@crm/ui';
import {
  ValueInput,
  addCondition,
  changeField,
  changeOperator,
  conditionsOf,
  inputKindOf,
  newCondition,
  removeNode,
  setValue,
  valueProblem,
  type Condition,
  type FieldDef,
  type Group,
  type Operator,
} from '@/features/segments';
import { conditionsFromProps, propsFromConditions } from '../lib/property-filters';
import { FilterIcon, PlusIcon, TrashIcon } from './icons';

/**
 * "Properties": conditions on the workspace's company properties (BL-196), in the vocabulary of segment rules. A row is a property,
 * an operator and a value; the rows are applied together (all must hold). A half-filled row is shown as such and left out of what
 * is applied. The conditions live in the address, so a filtered list can be shared.
 */
export function PropertyFilters({
  fields,
  value,
  onApply,
}: {
  fields: readonly FieldDef[];
  value: readonly CompanyPropertyFilter[];
  onApply: (props: CompanyPropertyFilter[]) => void;
}) {
  const t = useTranslations('companies.propertyFilters');
  const [open, setOpen] = useState(false);
  const applied = value.length;

  return (
    <div className="relative">
      <Button
        variant="secondary"
        className="h-10 gap-2"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <FilterIcon /> {t('button')}
        {applied > 0 && (
          <span className="rounded-full bg-brand px-1.5 text-xs font-semibold text-brand-foreground">
            {applied}
          </span>
        )}
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={t('label')}
        className="start-0 end-auto w-[min(38rem,calc(100vw-2rem))]"
      >
        {open && (
          <Editor
            fields={fields}
            value={value}
            onApply={(props) => {
              onApply(props);
              setOpen(false);
            }}
          />
        )}
      </Popover>
    </div>
  );
}

function Editor({
  fields,
  value,
  onApply,
}: {
  fields: readonly FieldDef[];
  value: readonly CompanyPropertyFilter[];
  onApply: (props: CompanyPropertyFilter[]) => void;
}) {
  const t = useTranslations('companies.propertyFilters');
  const to = useTranslations('segments.operators');
  const tp = useTranslations('segments.problem');
  const [root, setRoot] = useState<Group>(() => conditionsFromProps(value, fields));
  const [tried, setTried] = useState(false);
  const rows = conditionsOf(root);
  const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

  const problemOf = (c: Condition) => {
    const f = byId.get(c.field);
    return f ? valueProblem(c, f.kind) : 'empty';
  };
  const operatorName = (f: FieldDef | undefined, op: Operator) =>
    to(f?.kind === 'date' && op === 'equals' ? 'equals_date' : op);

  const add = () => {
    const first = fields[0];
    if (!first) return;
    setRoot((r) => addCondition(r, r.id, newCondition(first)));
  };
  const apply = () => {
    if (rows.some((c) => problemOf(c) !== null)) {
      setTried(true);
      return;
    }
    onApply(propsFromConditions(root, fields));
  };

  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noProperties')}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('none')}</p>}
      <ul className="space-y-2">
        {rows.map((c, i) => {
          const f = byId.get(c.field);
          const problem = tried ? problemOf(c) : null;
          const hasValue = f ? inputKindOf(f.kind, c.operator) !== 'none' : false;
          return (
            <li
              key={c.id}
              className="flex flex-wrap items-start gap-2 rounded-md border border-border p-2"
            >
              <Select
                aria-label={t('property', { n: i + 1 })}
                className="w-full sm:w-44"
                value={c.field}
                onChange={(e) => {
                  const next = byId.get(e.target.value);
                  if (next) setRoot((r) => changeField(r, c.id, next));
                }}
              >
                {fields.map((o) => (
                  <option key={o.id} value={o.id}>
                    {'text' in o.label ? o.label.text : o.id}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('operator', { n: i + 1 })}
                className="w-full sm:w-44"
                value={c.operator}
                onChange={(e) => {
                  if (f) setRoot((r) => changeOperator(r, c.id, f, e.target.value as Operator));
                }}
              >
                {(f?.operators ?? [c.operator]).map((op) => (
                  <option key={op} value={op}>
                    {operatorName(f, op)}
                  </option>
                ))}
              </Select>
              {f && hasValue && (
                <div className="min-w-0 flex-1 basis-full sm:basis-48">
                  <ValueInput
                    field={f}
                    operator={c.operator}
                    value={c.value}
                    invalid={problem !== null}
                    label={t('value', { n: i + 1 })}
                    onChange={(v) => setRoot((r) => setValue(r, c.id, v))}
                  />
                  {problem && (
                    <p role="alert" className="mt-1 text-xs text-danger">
                      {tp(problem)}
                    </p>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setRoot((r) => removeNode(r, c.id))}
                aria-label={t('remove', { n: i + 1 })}
                title={t('remove', { n: i + 1 })}
                className="ms-auto inline-grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-primary"
              >
                <TrashIcon />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={add}>
          <PlusIcon /> {t('add')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ms-auto"
          onClick={() => {
            setRoot((r) => ({ ...r, children: [] }));
            onApply([]);
          }}
        >
          {t('clear')}
        </Button>
        <Button variant="brand" size="sm" onClick={apply}>
          {t('apply')}
        </Button>
      </div>
    </div>
  );
}
