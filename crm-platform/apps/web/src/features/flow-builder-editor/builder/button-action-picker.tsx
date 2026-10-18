'use client';

import { useContext } from 'react';
import { useTranslations } from 'next-intl';
import { flbLinkableFlows, type FlbBuilderContext } from '@crm/contracts';
import { Input, Select } from '@crm/ui';
import { FlowEditorContext } from '../lib/flow-editor-context';
import {
  BUTTON_ACTION_KINDS,
  type ButtonAction,
  type ButtonActionKind,
} from '../lib/button-actions';

/**
 * "Button pressed action" for one Quick replies button: carry on to the next step (nothing), start another flow, hand the customer
 * to a live agent, or opt the contact in or out of marketing. Used by both builders; it only edits the one action, the caller writes
 * it into the node's data (see lib/button-actions).
 */
export function ButtonActionPicker({
  value,
  onChange,
  ctx,
  loading = false,
  flowId,
}: {
  value: ButtonAction;
  onChange: (next: ButtonAction) => void;
  ctx: FlbBuilderContext;
  /** The builder context is still loading: the pickers say so. */
  loading?: boolean;
  /** The flow being edited: a flow cannot start itself, so it is not offered. */
  flowId: string | null;
}) {
  const t = useTranslations('flb.builder.buttonAction');
  const ts = useTranslations('flb.builder.simple.editors');
  const th = useTranslations('flb.builder.formsCore.helpers');
  // Opting in or out is a WhatsApp (messaging) consent: a website chat visitor has none to change.
  const { web, channel } = useContext(FlowEditorContext);
  const kinds = BUTTON_ACTION_KINDS.filter((k) => !web || (k !== 'opt_in' && k !== 'opt_out'));

  const choose = (kind: ButtonActionKind) => {
    if (kind === value.kind) return;
    if (kind === 'flow') onChange({ kind, flow: '' });
    else if (kind === 'live_agent') onChange({ kind, team: '', message: '' });
    else onChange({ kind } as ButtonAction);
  };
  // A conversation stays on its channel: only bots of this bot's channel are offered (a WhatsApp bot never lists a website chat bot).
  const flows = channel
    ? flbLinkableFlows(ctx.flows, channel, flowId)
    : ctx.flows.filter((f) => f.id !== flowId);
  const picked = value.kind === 'flow' ? value.flow : '';

  return (
    <div className="space-y-2" data-testid="button-action">
      <label className="block">
        <span className="mb-1 block text-[11.5px] font-medium text-muted-foreground">
          {t('label')}
        </span>
        <Select
          value={value.kind}
          aria-label={t('label')}
          onChange={(e) => choose(e.target.value as ButtonActionKind)}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}`)}
            </option>
          ))}
        </Select>
      </label>

      {value.kind === 'flow' ? (
        <Select
          value={picked}
          aria-label={t('pickFlow')}
          onChange={(e) => onChange({ kind: 'flow', flow: e.target.value })}
        >
          <option value="">{loading ? t('loadingFlows') : t('pickFlow')}</option>
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              {th(f.isPublished ? 'subflowLive' : 'subflowDraft', {
                name: f.name || th('flowFallback'),
              })}
            </option>
          ))}
          {picked && !flows.some((f) => f.id === picked) ? (
            <option value={picked}>{t('flowMissing', { id: picked.slice(0, 8) })}</option>
          ) : null}
        </Select>
      ) : null}

      {value.kind === 'live_agent' ? (
        <>
          <Select
            value={value.team}
            aria-label={ts('assign.pickTeam')}
            onChange={(e) => onChange({ ...value, team: e.target.value })}
          >
            <option value="">
              {ctx.teams.length ? ts('assign.pickTeam') : ts('assign.noTeams')}
            </option>
            {ctx.teams.map((tm) => (
              <option key={tm.id} value={tm.id}>
                {ts('assign.teamOption', { name: tm.name, count: tm.members.length })}
              </option>
            ))}
          </Select>
          <Input
            value={value.message}
            placeholder={ts('assign.note')}
            onChange={(e) => onChange({ ...value, message: e.target.value })}
          />
        </>
      ) : null}

      {value.kind !== 'none' ? (
        <p className="text-[11.5px] text-muted-foreground">{t(`hint.${value.kind}`)}</p>
      ) : null}
    </div>
  );
}
