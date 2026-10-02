'use client';

import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { StatusOptionResponse } from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Select, Spinner, Switch, cn, useToast } from '@crm/ui';
import { createStatusOption, invalidateStatusOptions, updateStatusOption } from '../api/stages';
import { errorKind } from '../lib/errors';
import {
  COLOR_PALETTE,
  checkLabel,
  isHexColor,
  LABEL_MAX,
  optionColor,
  STAGE_GROUP,
  stageColor,
  valueFromLabel,
  type OptionGroup,
} from '../lib/stage-model';
import { flagsOf, meaningOf, type StageMeaning } from '../lib/stage-flow';
import { StageBadge } from './chips';
import { ErrorLine } from './error-line';
import { CheckIcon } from './icons';

/** Add / edit one stage or status: its name, colour, whether new contacts start in it, and whether it can be picked. */
export function StageModal({
  open,
  group,
  option,
  siblings,
  stages,
  onClose,
}: {
  open: boolean;
  group: OptionGroup;
  /** Present = edit this option; absent = add a new one. */
  option?: StatusOptionResponse;
  /** Every option of the group (the name must differ from all the others). */
  siblings: readonly StatusOptionResponse[];
  /** The workspace's lifecycle stages: what a status can be limited to. */
  stages: readonly StatusOptionResponse[];
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.stages');
  const kind = group === STAGE_GROUP ? 'stage' : 'status';
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={t(`${kind}.eyebrow`)}
      title={option ? t('modal.editTitle') : t(`${kind}.addTitle`)}
      closeLabel={t('modal.close')}
    >
      {open && (
        <StageForm
          key={option?.id ?? 'new'}
          group={group}
          option={option}
          siblings={siblings}
          stages={stages}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function StageForm({
  group,
  option,
  siblings,
  stages,
  onClose,
}: {
  group: OptionGroup;
  option?: StatusOptionResponse;
  siblings: readonly StatusOptionResponse[];
  stages: readonly StatusOptionResponse[];
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.stages');
  const qc = useQueryClient();
  const { toast } = useToast();
  const uid = useId();
  const editing = option !== undefined;
  const isStage = group === STAGE_GROUP;

  const [label, setLabel] = useState(option?.label ?? '');
  const [color, setColor] = useState<string>(option ? optionColor(option) : COLOR_PALETTE[0]);
  const [isDefault, setDefault] = useState(option?.isDefault ?? false);
  const [active, setActive] = useState(option?.isActive ?? true);
  const [meaning, setMeaning] = useState<StageMeaning>(option ? meaningOf(option) : 'none');
  const [problem, setProblem] = useState<string | null>(null);
  /** Statuses only: the stage this status is limited to ('' = every stage). */
  const [scopeId, setScopeId] = useState(option?.stageOptionId ?? '');
  const scoped = !isStage && scopeId !== '';

  const others = siblings.filter((s) => s.id !== option?.id);
  const value =
    option?.value ??
    valueFromLabel(
      label,
      siblings.map((s) => s.value),
      isStage ? 'stage' : 'status',
    );

  const save = useMutation({
    mutationFn: async () => {
      if (option) {
        return updateStatusOption(option, {
          ...(label.trim() !== option.label ? { label: label.trim() } : {}),
          ...(color !== optionColor(option) ? { color } : {}),
          // A stage default, or the default status of a stage; a status on all stages has none (a default makes no sense there).
          ...((isStage || scoped) && isDefault !== option.isDefault ? { isDefault } : {}),
          ...(!isStage && !scoped && option.isDefault && option.stageOptionId
            ? { isDefault: false }
            : {}),
          ...(!isStage && scopeId !== (option.stageOptionId ?? '')
            ? { stageOptionId: scopeId || null }
            : {}),
          ...(active !== option.isActive ? { isActive: active } : {}),
          ...(isStage && meaning !== meaningOf(option) ? flagsOf(meaning) : {}),
        });
      }
      return createStatusOption(group, {
        value,
        label,
        color,
        isDefault: (isStage || scoped) && isDefault,
        ...(isStage ? flagsOf(meaning) : {}),
        ...(scoped ? { stageOptionId: scopeId } : {}),
      });
    },
    onSuccess: async () => {
      await invalidateStatusOptions(qc);
      toast(editing ? t('modal.updated') : t('modal.added'), 'success');
      onClose();
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = checkLabel(label, others);
    setProblem(found ? t(`modal.problem.${found}`) : null);
    if (found) {
      document.getElementById(`${uid}-label`)?.focus();
      return;
    }
    save.mutate();
  }

  const conflict = save.isError && errorKind(save.error) === 'conflict';

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {save.isError && (
        <div className="space-y-2">
          <ErrorLine error={save.error} />
          {conflict && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void invalidateStatusOptions(qc).then(onClose)}
            >
              {t('modal.reload')}
            </Button>
          )}
        </div>
      )}

      <div
        className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border bg-muted/40 px-3 py-3"
        aria-live="polite"
      >
        <span className="text-xs text-muted-foreground">{t('modal.preview')}</span>
        <StageBadge stage={value} label={label.trim() || t('modal.previewEmpty')} color={color} />
      </div>

      <Field
        label={`${t('modal.name')} *`}
        htmlFor={`${uid}-label`}
        error={problem ?? undefined}
        hint={
          <>
            {editing ? t('modal.keyFixed') : t('modal.keyHint')}{' '}
            <code dir="ltr" className="font-mono">
              {value}
            </code>
          </>
        }
      >
        <Input
          id={`${uid}-label`}
          value={label}
          maxLength={LABEL_MAX}
          invalid={Boolean(problem)}
          autoFocus
          placeholder={t(isStage ? 'stage.namePlaceholder' : 'status.namePlaceholder')}
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('modal.color')}</legend>
        <div className="flex flex-wrap items-center gap-2">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={color.toLowerCase() === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn(
                'inline-flex size-7 items-center justify-center rounded-full border-2 text-white outline-none focus-visible:ring-2 focus-visible:ring-primary',
                color.toLowerCase() === c ? 'border-foreground' : 'border-transparent',
              )}
              style={{ background: c }}
            >
              {color.toLowerCase() === c && <CheckIcon className="size-3.5" />}
            </button>
          ))}
          <label className="ms-1 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="color"
              value={isHexColor(color) ? color : stageColor(value)}
              onChange={(e) => setColor(e.target.value)}
              aria-label={t('modal.customColor')}
              className="size-7 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
            {t('modal.customColor')}
          </label>
        </div>
      </fieldset>

      {!isStage && (
        <Field
          label={t('modal.scope.label')}
          htmlFor={`${uid}-scope`}
          hint={
            stages.length === 0
              ? t('modal.scope.noStages')
              : editing && option?.stageOptionId !== (scopeId || null)
                ? t('modal.scope.moveNote')
                : t('modal.scope.hint')
          }
        >
          <Select
            id={`${uid}-scope`}
            value={scopeId}
            disabled={stages.length === 0 && scopeId === ''}
            onChange={(e) => setScopeId(e.target.value)}
          >
            <option value="">{t('modal.scope.all')}</option>
            {stages.map((st) => (
              <option key={st.id} value={st.id}>
                {st.label}
                {st.isActive ? '' : ` (${t('row.hidden')})`}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {(isStage || scoped) && (
        <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
          <div className="min-w-0 text-sm">
            <label htmlFor={`${uid}-default`} className="block font-medium">
              {isStage ? t('modal.default') : t('modal.scope.default')}
            </label>
            <p className="text-xs text-muted-foreground">
              {isStage ? t('modal.defaultHint') : t('modal.scope.defaultHint')}
            </p>
          </div>
          <Switch
            id={`${uid}-default`}
            checked={isDefault}
            onCheckedChange={setDefault}
            label={isStage ? t('modal.default') : t('modal.scope.default')}
          />
        </div>
      )}

      {isStage && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('modal.meaning.title')}</legend>
          <p className="text-xs text-muted-foreground">{t('modal.meaning.hint')}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['none', 'won', 'lost'] as const).map((m) => (
              <label
                key={m}
                className={cn(
                  'flex cursor-pointer flex-col gap-0.5 rounded-md border p-2.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
                  meaning === m ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input
                    type="radio"
                    name={`${uid}-meaning`}
                    value={m}
                    checked={meaning === m}
                    onChange={() => setMeaning(m)}
                    className="accent-[var(--primary)]"
                  />
                  {t(`modal.meaning.${m}`)}
                </span>
                <span className="ps-6 text-xs text-muted-foreground">
                  {t(`modal.meaning.${m}Hint`)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {editing && (
        <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
          <div className="min-w-0 text-sm">
            <label htmlFor={`${uid}-active`} className="block font-medium">
              {t('modal.active')}
            </label>
            <p className="text-xs text-muted-foreground">{t('modal.activeHint')}</p>
          </div>
          <Switch
            id={`${uid}-active`}
            checked={active}
            onCheckedChange={setActive}
            label={t('modal.active')}
          />
        </div>
      )}

      {editing && isStage && !active && option?.isDefault && (
        <Alert tone="warning">{t('modal.defaultInactive')}</Alert>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          {t('modal.cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner />}
          {editing ? t('modal.save') : t('modal.add')}
        </Button>
      </div>
    </form>
  );
}
