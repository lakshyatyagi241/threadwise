'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input, Popover, Select, cn } from '@crm/ui';
import type { Stage, StageKind } from '../api/schemas';
import {
  STAGE_COLORS,
  probabilityFor,
  validateStage,
  type StageProblem,
} from '../lib/stage-editor';
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from './icons';

const KINDS: readonly StageKind[] = ['open', 'won', 'lost'];

/** A colour swatch that opens a small panel of preset colours and a hex field. */
function ColorPicker({
  value,
  onPick,
  disabled,
  label,
}: {
  value: string;
  onPick: (hex: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value);
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        onClick={() => {
          setHex(value);
          setOpen((o) => !o);
        }}
        className="flex size-10 items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-50"
      >
        <span
          className="size-5 rounded-full border border-black/10"
          style={{ backgroundColor: value }}
        />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={label}
        className="start-0 end-auto w-56"
      >
        <div className="grid grid-cols-4 gap-2">
          {STAGE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
              className={cn(
                'size-9 rounded-full border-2',
                c.toLowerCase() === value.toLowerCase()
                  ? 'border-foreground'
                  : 'border-transparent',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <Input
          value={hex}
          maxLength={7}
          aria-label={label}
          onChange={(e) => setHex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && /^#[0-9a-fA-F]{6}$/.test(hex)) {
              onPick(hex.toUpperCase());
              setOpen(false);
            }
          }}
        />
      </Popover>
    </div>
  );
}

export interface StageRowProps {
  stage: Stage;
  siblings: readonly Stage[];
  index: number;
  count: number;
  disabled: boolean;
  onSave: (
    stage: Stage,
    patch: { name?: string; color?: string; probability?: number; kind?: StageKind },
  ) => void;
  onMove: (index: number, to: number) => void;
  onDelete: (stage: Stage) => void;
}

/** One stage of the pipeline: colour, name, win probability, kind (open, won, lost), order arrows and delete. */
export function StageRow({
  stage,
  siblings,
  index,
  count,
  disabled,
  onSave,
  onMove,
  onDelete,
}: StageRowProps) {
  const t = useTranslations('deals-pipelines.settings');
  const [problems, setProblems] = useState<StageProblem[]>([]);

  function commit(patch: Partial<Pick<Stage, 'name' | 'color' | 'probability' | 'kind'>>) {
    const kind = patch.kind ?? stage.kind;
    const next = {
      name: patch.name ?? stage.name,
      color: patch.color ?? stage.color,
      kind,
      probability: probabilityFor(kind, patch.probability ?? stage.probability),
    };
    const found = validateStage(next, siblings, stage.id);
    setProblems(found);
    if (found.length > 0) return;
    if (
      next.name.trim() === stage.name &&
      next.color === stage.color &&
      next.kind === stage.kind &&
      next.probability === stage.probability
    ) {
      return;
    }
    onSave(stage, { ...next, name: next.name.trim() });
  }

  const fixed = stage.kind !== 'open';
  return (
    <li className="rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-col">
          <button
            type="button"
            disabled={disabled || index === 0}
            aria-label={t('moveUp', { name: stage.name })}
            onClick={() => onMove(index, index - 1)}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30"
          >
            <ChevronUpIcon className="size-3.5" />
          </button>
          <button
            type="button"
            disabled={disabled || index === count - 1}
            aria-label={t('moveDown', { name: stage.name })}
            onClick={() => onMove(index, index + 1)}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30"
          >
            <ChevronDownIcon className="size-3.5" />
          </button>
        </div>
        <ColorPicker
          value={stage.color}
          disabled={disabled}
          label={t('color', { name: stage.name })}
          onPick={(hex) => commit({ color: hex })}
        />
        <Input
          key={stage.name}
          defaultValue={stage.name}
          maxLength={120}
          disabled={disabled}
          aria-label={t('stageName')}
          invalid={problems.includes('nameRequired') || problems.includes('nameTooLong')}
          className="min-w-40 flex-1"
          onBlur={(e) => commit({ name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <Select
          aria-label={t('kind')}
          title={stage.dealCount > 0 ? t('kindLocked') : undefined}
          disabled={disabled || stage.dealCount > 0}
          value={stage.kind}
          className="w-auto min-w-28"
          onChange={(e) => commit({ kind: e.target.value as StageKind })}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1">
          <Input
            key={`${stage.id}:${stage.probability}`}
            type="number"
            min={0}
            max={100}
            defaultValue={stage.probability}
            disabled={disabled || fixed}
            aria-label={t('probability')}
            invalid={problems.includes('probability')}
            className="w-20"
            onBlur={(e) => commit({ probability: Number(e.target.value) })}
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {t('dealCount', { count: stage.dealCount })}
        </span>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('deleteStage', { name: stage.name })}
          onClick={() => onDelete(stage)}
          className="ms-auto flex size-9 items-center justify-center rounded-md text-danger hover:bg-danger/10 disabled:opacity-50"
        >
          <TrashIcon />
        </button>
      </div>
      {problems.length > 0 && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {problems.map((p) => t(`problems.${p}`)).join(' ')}
        </p>
      )}
    </li>
  );
}
