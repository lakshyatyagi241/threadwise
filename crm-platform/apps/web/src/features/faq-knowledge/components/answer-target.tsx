'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { FaqEntry } from '@crm/contracts';
import { cn } from '@crm/ui';
import { stepDisplayName, type FaqDraft } from '../lib/model';
import { useFaqFlow } from './faq-flow';
import { FlowNodeSelect } from './flow-node-select';
import { FlowPicker } from './flow-picker';

/**
 * "Go to a step": where a matching FAQ sends the customer. The common case is a step of THIS flow (the default); the second choice
 * is a step of another flow, picked from the workspace's flows. The FAQ keeps the target flow's id (`flowId`) and the step
 * (`flowNodeId`), so an FAQ that points at another flow is the same record as before.
 */
export function AnswerTarget({
  draft,
  entry,
  readOnly,
  flowMissing,
  flowError,
  stepError,
  onChange,
}: {
  draft: FaqDraft;
  /** The entry as saved (null for a new FAQ). */
  entry: FaqEntry | null;
  readOnly: boolean;
  /** The saved target flow was deleted. */
  flowMissing: boolean;
  flowError?: string;
  stepError?: string;
  onChange: (patch: Partial<FaqDraft>) => void;
}) {
  const t = useTranslations('faq.editor.answer');
  const { flowId, flowName } = useFaqFlow();
  const groupId = useId();
  // The choice is its own state: "another flow" has no flow yet right after it is picked.
  // A saved FAQ whose target flow was deleted opens on "another flow", where the warning and the picker are.
  const [other, setOther] = useState(
    flowMissing || (draft.flowId !== null && draft.flowId !== flowId),
  );
  const here = !other;

  if (readOnly) {
    return (
      <div className="space-y-2" id="faq-flow">
        <p className="text-sm font-medium">{t('flowLabel')}</p>
        <p className="text-sm">
          {draft.flowId === flowId
            ? t('thisFlowNamed', { name: flowName })
            : (draft.flowName ?? t('noFlow'))}
        </p>
        {entry?.flowNodeId && (
          <p
            className={cn(
              'text-sm',
              entry.flowNodeLabel === null ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {entry.flowNodeLabel === null
              ? t('stepGone')
              : t('startsAt', { step: stepDisplayName(entry.flowNodeLabel) })}
          </p>
        )}
      </div>
    );
  }

  const choose = (toOther: boolean) => {
    if (toOther === other) return;
    setOther(toOther);
    // A step belongs to one flow: changing the kind of target clears the step.
    onChange(
      toOther
        ? { flowId: null, flowName: null, flowNodeId: null }
        : { flowId, flowName, flowNodeId: null },
    );
  };

  return (
    <div className="space-y-3" id="faq-flow">
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">{t('flowLabel')}</legend>
        {[false, true].map((toOther) => (
          <label
            key={String(toOther)}
            htmlFor={`${groupId}-${toOther ? 'other' : 'here'}`}
            className="flex cursor-pointer items-start gap-2 text-sm"
          >
            <input
              id={`${groupId}-${toOther ? 'other' : 'here'}`}
              type="radio"
              name={`${groupId}-target`}
              className="mt-0.5 size-4 accent-[var(--primary)]"
              checked={toOther === other}
              onChange={() => choose(toOther)}
            />
            <span>
              <span className="font-medium">{toOther ? t('target.other') : t('target.here')}</span>
              <span className="block text-xs text-muted-foreground">
                {toOther ? t('target.otherHint') : t('target.hereHint', { name: flowName })}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {other && (
        <FlowPicker
          value={draft.flowId ? { id: draft.flowId, name: draft.flowName ?? '' } : null}
          missing={flowMissing}
          exclude={flowId}
          invalid={!!flowError}
          describedBy="faq-flow-error"
          onChange={(f) =>
            // A step belongs to one flow: choosing another flow clears it (choosing the same one keeps it).
            onChange({
              flowId: f.id,
              flowName: f.name,
              flowNodeId: f.id === draft.flowId ? draft.flowNodeId : null,
            })
          }
        />
      )}
      {flowError && (
        <p id="faq-flow-error" role="alert" tabIndex={-1} className="text-xs text-danger">
          {flowError}
        </p>
      )}
      {draft.flowId && !flowMissing && (
        <FlowNodeSelect
          // The steps of one flow are not the steps of another: a new flow starts a fresh select.
          key={draft.flowId}
          flowId={draft.flowId}
          own={here}
          value={draft.flowNodeId}
          saved={entry}
          invalid={!!stepError}
          error={stepError}
          onChange={(flowNodeId) => onChange({ flowNodeId })}
        />
      )}
    </div>
  );
}
