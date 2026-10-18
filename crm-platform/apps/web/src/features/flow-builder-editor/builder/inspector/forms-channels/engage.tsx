'use client';

import { useTranslations } from 'next-intl';
import { flbLinkableFlows } from '@crm/contracts';
import { Field, SelectInput } from '../kit';
import type { FormComponent } from '../types';
import { agentOptionLabel, flowOptionLabel, withSavedOption } from './helpers';
import { ExtLink, PlusIcon } from './shared';

const NS = 'flb.builder.formsChannels.engage';

/**
 * Sub-flow and Chatbot forms (TW-FLB-046, 051). They register in `CHANNEL_FORMS`, which the registry spreads over
 * `CORE_FORMS`, so these two replace the earlier versions: the flow option carries Reference's `· live` / `· draft` suffix
 * and the agent option its `provider/model`, both read from the richer builder context.
 */
export const SubflowForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const th = useTranslations('flb.builder.formsChannels.helpers');
  const { flows } = p.env.ctx;
  const opts = withSavedOption(
    [
      { v: '', l: p.env.loading ? t('loadingFlows') : t('pickFlow') },
      // A flow cannot call itself, and only bots of this channel are offered (a conversation cannot move to another channel).
      ...flbLinkableFlows(flows, p.env.mode, p.env.flowId).map((f) => ({
        v: f.id,
        l: flowOptionLabel(f.name, f.isPublished, th),
      })),
    ],
    p.data.flow,
    (id) => t('savedFlow', { id: id.slice(0, 8) }),
  );
  return (
    <Field label={t('flowToRun')} hint={t('flowToRunHint')}>
      <SelectInput value={p.data.flow} onChange={(v) => p.set('flow', v)} options={opts} />
    </Field>
  );
};

export const ChatbotForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const th = useTranslations('flb.builder.formsChannels.helpers');
  const { agents } = p.env.ctx;
  const opts = withSavedOption(
    [
      {
        v: '',
        l: agents.length ? t('pickAgent') : t('noAgents'),
      },
      ...agents.map((a) => ({
        v: a.id,
        l: agentOptionLabel(a.name, a.provider, a.model, a.id, th),
      })),
    ],
    p.data.bot,
    (id) => t('savedAgent', { id: id.slice(0, 8) }),
  );
  return (
    <Field
      label={t('agentToTrigger')}
      hint={
        agents.length
          ? t('agentHint')
          : t.rich('noAgentsHint', { link: (c) => <ExtLink href="/inbox">{c}</ExtLink> })
      }
    >
      <SelectInput value={p.data.bot} onChange={(v) => p.set('bot', v)} options={opts} />
      {/* Reference opens an inline "Create AI agent" modal here. Creating an agent belongs to the AI-agents part of the team inbox, which this
          app does not expose yet, so the button is shown off with the reason instead of doing nothing. */}
      <button
        type="button"
        disabled
        title={t('createUnavailableTitle')}
        className="mt-2 inline-flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-dashed border-brand/50 bg-muted px-3 py-2 text-[12px] font-semibold text-brand opacity-40"
      >
        <PlusIcon />
        {t('createAgent')}
      </button>
      <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-muted-foreground">
        <span>{t('createUnavailable')}</span>
        <button type="button" onClick={() => p.env.refresh()} className="text-brand underline">
          {t('refresh')}
        </button>
      </div>
    </Field>
  );
};
