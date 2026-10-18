'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Select, cn } from '@crm/ui';
import type { RuleAction } from '../lib/builder';
import { fieldsByGroup, findField, type FieldDef, type InvalidReason } from '../lib/fields';
import type { ValueProblem } from '../lib/model';
import {
  canAddCondition,
  canAddGroup,
  type Combinator,
  type Condition,
  type Group,
} from '../lib/model';
import { inputKindOf, type Operator } from '../lib/operators';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon, WarningIcon } from './icons';
import { ValueInput } from './value-inputs';

/** What a condition's warning says: the field is gone, some chosen values are gone, or the server flagged it. */
export type ConditionWarning =
  | InvalidReason
  /** A reason the server reported (`tag_deleted`, `operator_unsupported`...). */
  | { type: 'server'; reason: string };

export interface RuleBuilderContext {
  root: Group;
  catalog: readonly FieldDef[];
  fieldLabel: (field: FieldDef) => string;
  dispatch: (action: RuleAction) => void;
  /** Warnings by condition id. */
  warnings: ReadonlyMap<string, ConditionWarning>;
  /** What is wrong with each condition's value (shown once the person tried to save). */
  problems: Readonly<Record<string, ValueProblem | 'field'>>;
  showProblems: boolean;
  /** The server's own validation messages by condition id. */
  serverProblems: Readonly<Record<string, string>>;
  disabled?: boolean;
}

const Ctx = createContext<RuleBuilderContext | null>(null);
const useRules = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('RuleBuilder pieces render inside <RuleBuilder>');
  return c;
};

const iconBtn =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

/** The rule tree: nested AND/OR groups of conditions, with add, remove and reorder. */
export function RuleBuilder(props: RuleBuilderContext) {
  return (
    <Ctx.Provider value={props}>
      <GroupEditor group={props.root} level={1} index={0} siblings={1} prefix="" />
    </Ctx.Provider>
  );
}

function CombinatorToggle({ group }: { group: Group }) {
  const t = useTranslations('segments.builder');
  const { dispatch, disabled } = useRules();
  const label = t('matchLabel');
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex overflow-hidden rounded-md border border-border"
      >
        {(['and', 'or'] as const satisfies readonly Combinator[]).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={group.combinator === c}
            disabled={disabled}
            onClick={() => dispatch({ type: 'combinator', groupId: group.id, combinator: c })}
            className={cn(
              'h-8 px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:opacity-60',
              group.combinator === c ? 'bg-brand text-brand-foreground' : 'hover:bg-muted',
            )}
          >
            {t(c === 'and' ? 'matchAll' : 'matchAny')}
          </button>
        ))}
      </div>
      <span className="text-muted-foreground">
        {t(group.combinator === 'and' ? 'matchAllHint' : 'matchAnyHint')}
      </span>
    </div>
  );
}

function GroupEditor({
  group,
  level,
  index,
  siblings,
  prefix,
}: {
  group: Group;
  level: number;
  index: number;
  siblings: number;
  /** Numbering of this group's conditions: '' at the top, '3.' inside the third item ("3.1", "3.2"). */
  prefix: string;
}) {
  const t = useTranslations('segments.builder');
  const { root, dispatch, disabled } = useRules();
  const nested = level > 1;
  const addCond = canAddCondition(root, group.id);
  const addGrp = canAddGroup(root, group.id);
  return (
    <div
      role="group"
      aria-label={nested ? t('groupN', { level }) : t('rootGroup')}
      className={cn(
        'space-y-2 rounded-lg border p-3',
        nested ? 'border-brand/30 bg-brand/5' : 'border-border bg-background',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CombinatorToggle group={group} />
        {nested && (
          <div className="flex items-center gap-1">
            <MoveButtons id={group.id} index={index} count={siblings} />
            <button
              type="button"
              disabled={disabled}
              onClick={() => dispatch({ type: 'remove', id: group.id })}
              aria-label={t('removeGroup')}
              title={t('removeGroup')}
              className={cn(iconBtn, 'hover:text-danger')}
            >
              <TrashIcon className="size-4" />
            </button>
          </div>
        )}
      </div>

      {group.children.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          {t('emptyGroup')}
        </p>
      )}

      <ol className="space-y-2">
        {group.children.map((child, i) => (
          <li key={child.id} className="space-y-2">
            {i > 0 && (
              <div
                aria-hidden="true"
                className="ps-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t(group.combinator)}
              </div>
            )}
            {child.kind === 'condition' ? (
              <ConditionRow
                condition={child}
                number={`${prefix}${i + 1}`}
                index={i}
                count={group.children.length}
              />
            ) : (
              <GroupEditor
                group={child}
                level={level + 1}
                index={i}
                siblings={group.children.length}
                prefix={`${prefix}${i + 1}.`}
              />
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || !addCond}
          onClick={() => dispatch({ type: 'addCondition', groupId: group.id })}
        >
          <PlusIcon className="size-3.5" />
          {t('addCondition')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || !addGrp}
          title={!addGrp && addCond ? t('depthLimit') : undefined}
          onClick={() => dispatch({ type: 'addGroup', groupId: group.id })}
        >
          <PlusIcon className="size-3.5" />
          {t('addGroup')}
        </Button>
        {!addCond && <span className="text-xs text-muted-foreground">{t('limitReached')}</span>}
      </div>
    </div>
  );
}

function MoveButtons({ id, index, count }: { id: string; index: number; count: number }) {
  const t = useTranslations('segments.builder');
  const { dispatch, disabled } = useRules();
  return (
    <>
      <button
        type="button"
        disabled={disabled || index === 0}
        onClick={() => dispatch({ type: 'move', id, direction: -1 })}
        aria-label={t('moveUp')}
        title={t('moveUp')}
        className={iconBtn}
      >
        <ArrowUpIcon className="size-4" />
      </button>
      <button
        type="button"
        disabled={disabled || index === count - 1}
        onClick={() => dispatch({ type: 'move', id, direction: 1 })}
        aria-label={t('moveDown')}
        title={t('moveDown')}
        className={iconBtn}
      >
        <ArrowDownIcon className="size-4" />
      </button>
    </>
  );
}

function FieldSelect({ condition, label }: { condition: Condition; label: string }) {
  const t = useTranslations('segments.builder');
  const tg = useTranslations('segments.fieldGroups');
  const { catalog, fieldLabel, dispatch, disabled } = useRules();
  const known = findField(catalog, condition.field);
  return (
    <Select
      value={condition.field}
      disabled={disabled}
      invalid={!known}
      aria-label={label}
      onChange={(e) => dispatch({ type: 'field', id: condition.id, field: e.target.value })}
    >
      {!known && (
        <option value={condition.field} disabled>
          {t('deletedField', { key: condition.field })}
        </option>
      )}
      {/* A field that is not offered any more but is still in this rule (the lead score while scoring is off) reads as it did. */}
      {known?.hidden && (
        <option value={known.id} disabled>
          {fieldLabel(known)}
        </option>
      )}
      {fieldsByGroup(catalog).map((g) => (
        <optgroup key={g.group} label={tg(g.group)}>
          {g.fields.map((f) => (
            <option key={f.id} value={f.id}>
              {fieldLabel(f)}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

function OperatorSelect({
  condition,
  field,
  label,
}: {
  condition: Condition;
  field: FieldDef | undefined;
  label: string;
}) {
  const t = useTranslations('segments.operators');
  const { dispatch, disabled } = useRules();
  const ops = field?.operators ?? [condition.operator];
  const name = (op: Operator) => t(field?.kind === 'date' && op === 'equals' ? 'equals_date' : op);
  return (
    <Select
      value={condition.operator}
      disabled={disabled || !field}
      aria-label={label}
      onChange={(e) =>
        dispatch({ type: 'operator', id: condition.id, operator: e.target.value as Operator })
      }
    >
      {ops.map((op) => (
        <option key={op} value={op}>
          {name(op)}
        </option>
      ))}
    </Select>
  );
}

/** The fix prompt of a condition that points at something deleted. */
function Warning({ condition, warning }: { condition: Condition; warning: ConditionWarning }) {
  const t = useTranslations('segments.invalid');
  const { dispatch, disabled } = useRules();
  const message =
    warning.type === 'field'
      ? t('field')
      : warning.type === 'values'
        ? t('values', { count: warning.missing.length })
        : t(`reason.${warning.reason}`);
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        <WarningIcon className="size-3.5" />
        {message}
      </span>
      <span className="text-foreground/80">
        {t(warning.type === 'field' ? 'fixField' : 'fixValues')}
      </span>
      <span className="ms-auto flex gap-2">
        {warning.type === 'values' && (
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              dispatch({ type: 'dropMissing', id: condition.id, missing: warning.missing })
            }
            className="font-semibold text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('removeValues')}
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => dispatch({ type: 'remove', id: condition.id })}
          className="font-semibold text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('removeCondition')}
        </button>
      </span>
    </div>
  );
}

function ConditionRow({
  condition,
  number,
  index,
  count,
}: {
  condition: Condition;
  number: string;
  index: number;
  count: number;
}) {
  const t = useTranslations('segments.builder');
  const tp = useTranslations('segments.problem');
  const { catalog, dispatch, disabled, warnings, problems, showProblems, serverProblems } =
    useRules();
  const field = findField(catalog, condition.field);
  const warning = warnings.get(condition.id);
  const problem = showProblems ? problems[condition.id] : undefined;
  const serverMessage = serverProblems[condition.id];
  const hasValue = field ? inputKindOf(field.kind, condition.operator) !== 'none' : false;
  const valueLabel = t('valueOf', { n: number });
  return (
    <div
      role="group"
      aria-label={t('conditionN', { n: number })}
      className={cn(
        'space-y-2 rounded-md border bg-background p-2.5',
        warning
          ? 'border-warning/50'
          : problem || serverMessage
            ? 'border-danger/50'
            : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="w-full sm:w-52">
          <FieldSelect condition={condition} label={t('fieldOf', { n: number })} />
        </div>
        <div className="w-full sm:w-48">
          <OperatorSelect
            condition={condition}
            field={field}
            label={t('operatorOf', { n: number })}
          />
        </div>
        {field && hasValue && (
          <div className="min-w-0 flex-1 basis-full sm:basis-64">
            <ValueInput
              field={field}
              operator={condition.operator}
              value={condition.value}
              disabled={disabled}
              invalid={Boolean(problem) || Boolean(serverMessage)}
              label={valueLabel}
              onChange={(value) => dispatch({ type: 'value', id: condition.id, value })}
            />
          </div>
        )}
        <div className="ms-auto flex items-center gap-1">
          <MoveButtons id={condition.id} index={index} count={count} />
          <button
            type="button"
            disabled={disabled}
            onClick={() => dispatch({ type: 'remove', id: condition.id })}
            aria-label={t('removeCondition', { n: number })}
            title={t('removeCondition', { n: number })}
            className={cn(iconBtn, 'hover:text-danger')}
          >
            <TrashIcon className="size-4" />
          </button>
        </div>
      </div>
      {(problem || serverMessage) && (
        <p role="alert" className="text-xs text-danger">
          {problem ? tp(problem) : serverMessage}
        </p>
      )}
      {warning && <Warning condition={condition} warning={warning} />}
    </div>
  );
}

/** A labelled card for the builder's sections. */
export function Section({
  title,
  hint,
  children,
  aside,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-background">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
        </div>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
