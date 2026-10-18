'use client';

import { useContext } from 'react';
import { useTranslations } from 'next-intl';
import { flbLinkableFlows, type FlbBuilderContext, type FlowNode } from '@crm/contracts';
import { FlowEditorContext } from '../lib/flow-editor-context';
import { subflowLabel } from './inspector/forms-core/helpers';

/** The Run sub-flow card: pick (or change) the connected flow right on the node, without opening the inspector. */
export function SubflowCardBody({
  node,
  ctx,
  onPatch,
}: {
  node: FlowNode;
  ctx: FlbBuilderContext;
  onPatch?: (nodeId: string, patch: Record<string, unknown>) => void;
}) {
  const t = useTranslations('flb.builder.formsCore.logic');
  const th = useTranslations('flb.builder.formsCore.helpers');
  const current = typeof node.data?.flow === 'string' ? node.data.flow : '';
  const { flowId, channel } = useContext(FlowEditorContext);
  // Only bots of this channel (and never the bot itself) can be started from here.
  const flows = channel ? flbLinkableFlows(ctx.flows, channel, flowId) : ctx.flows;
  const known = flows.some((f) => f.id === current);
  return (
    <div className="px-3 pt-2 pb-2.5" data-testid="subflow-card">
      <select
        value={current}
        aria-label={t('subflowLabel')}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => onPatch?.(node.id, { flow: e.target.value })}
        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11.5px] outline-none focus:border-brand"
      >
        <option value="">{t('subflowPick')}</option>
        {current && !known ? (
          <option value={current}>{t('subflowMissing', { id: current.slice(0, 8) })}</option>
        ) : null}
        {flows.map((f) => (
          <option key={f.id} value={f.id}>
            {subflowLabel(th, f.name, f.isPublished)}
          </option>
        ))}
      </select>
    </div>
  );
}
