'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import type { FaqEntry } from '@crm/contracts';
import { Alert, Button, Field, Select } from '@crm/ui';
import { useFlowNodes } from '../api/hooks';
import { errorKey } from '../lib/errors';
import { stepIsMissing, stepOptions, stepSelectValue } from '../lib/model';

/**
 * "Go to": where in the target flow the FAQ sends the customer. The first choice is the flow's own start (sent as no step); the rest are the
 * flow's steps, named as the flow editor names them. A step that was deleted from the flow is called out with a way to fix it,
 * because until it is fixed customers get no answer from this FAQ.
 */
export function FlowNodeSelect({
  flowId,
  own,
  value,
  saved,
  invalid,
  error,
  onChange,
}: {
  flowId: string;
  /** The flow is the one the FAQ belongs to: its steps are the saved ones, so say so. */
  own?: boolean;
  value: string | null;
  /** The entry as saved, when there is one: a step it holds that has no name is already known to be gone. */
  saved: Pick<FaqEntry, 'flowId' | 'flowNodeId' | 'flowNodeLabel'> | null;
  invalid?: boolean;
  error?: string;
  onChange: (flowNodeId: string | null) => void;
}) {
  const t = useTranslations('faq.flowNode');
  const te = useTranslations('faq.errors');
  const id = useId();
  const nodes = useFlowNodes(flowId, true);
  const list = nodes.data?.data;
  const missing = stepIsMissing({ answerType: 'flow', flowId, flowNodeId: value }, saved, list);
  const options = list ? stepOptions(list) : [];

  const startAtFlowStart = () => {
    onChange(null);
    // The warning disappears with the click, so focus moves to the select it was about.
    requestAnimationFrame(() => document.getElementById(`${id}-select`)?.focus());
  };

  return (
    <div className="space-y-2" id="faq-flow-node">
      {missing && (
        <Alert tone="danger" className="space-y-2">
          <p className="font-semibold">{t('missing.title')}</p>
          <p>{t('missing.body')}</p>
          <Button size="sm" variant="secondary" onClick={startAtFlowStart}>
            {t('missing.fix')}
          </Button>
        </Alert>
      )}
      {nodes.isError ? (
        <p role="alert" className="text-sm text-danger">
          {te(errorKey(nodes.error))}{' '}
          <Button size="sm" variant="ghost" onClick={() => void nodes.refetch()}>
            {t('retry')}
          </Button>
        </p>
      ) : (
        <Field
          label={t('label')}
          htmlFor={`${id}-select`}
          error={error}
          hint={nodes.isPending ? t('loading') : own ? t('hintOwn') : t('hint')}
        >
          <Select
            id={`${id}-select`}
            value={stepSelectValue(value, list)}
            disabled={nodes.isPending}
            invalid={invalid}
            aria-busy={nodes.isPending || undefined}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">{t('start')}</option>
            {missing && value && <option value={value}>{t('deletedOption')}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {list && options.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">{t('empty')}</p>
          )}
        </Field>
      )}
    </div>
  );
}
