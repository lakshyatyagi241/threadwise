'use client';

import { Field, SelectInput } from '../kit';
import type { FormComponent } from '../types';
import { agentOptionLabel, flowOptionLabel, withSavedOption } from './helpers';
import { ExtLink } from './shared';

/**
 * Sub-flow and Chatbot forms (WD-FLB-046, 051). They register in `CHANNEL_FORMS`, which the registry spreads over
 * `CORE_FORMS`, so these two replace the earlier versions: the flow option carries WaDesk's `· live` / `· draft` suffix
 * and the agent option its `provider/model`, both read from the richer builder context.
 */
export const SubflowForm: FormComponent = (p) => {
  const { flows } = p.env.ctx;
  const opts = withSavedOption(
    [
      { v: '', l: p.env.loading ? 'Loading flows…' : '— pick flow —' },
      // A flow cannot call itself (the saved flow being edited is skipped).
      ...flows
        .filter((f) => f.id !== p.env.flowId)
        .map((f) => ({ v: f.id, l: flowOptionLabel(f.name, f.isPublished) })),
    ],
    p.data.flow,
    (id) => `Flow ${id.slice(0, 8)} (not in workspace)`,
  );
  return (
    <Field
      label="Flow to run"
      hint="Pick another saved flow. When this node fires, that flow runs end-to-end before control returns to the next node here."
    >
      <SelectInput value={p.data.flow} onChange={(v) => p.set('flow', v)} options={opts} />
    </Field>
  );
};

export const ChatbotForm: FormComponent = (p) => {
  const { agents } = p.env.ctx;
  const opts = withSavedOption(
    [
      {
        v: '',
        l: agents.length ? '— pick AI agent —' : 'No agents yet — add one in the team inbox',
      },
      ...agents.map((a) => ({ v: a.id, l: agentOptionLabel(a.name, a.provider, a.model, a.id) })),
    ],
    p.data.bot,
    (id) => `Agent ${id.slice(0, 8)} (not in workspace)`,
  );
  return (
    <Field
      label="AI agent to trigger"
      hint={
        agents.length ? (
          <>Pick a saved AI agent — its system prompt + model run when this node fires.</>
        ) : (
          <>
            Add your first AI agent in the <ExtLink href="/team-inbox">team inbox</ExtLink>, then
            pick it here.
          </>
        )
      }
    >
      <SelectInput value={p.data.bot} onChange={(v) => p.set('bot', v)} options={opts} />
      {/* WaDesk opens an inline "Create AI agent" modal here. Creating an agent belongs to the AI-agents part of the team inbox, which this
          app does not expose yet, so the button is shown off with the reason instead of doing nothing. */}
      <button
        type="button"
        disabled
        title="Creating an AI agent from the builder is not available yet. Add one in the team inbox."
        className="mt-2 inline-flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-dashed border-brand/50 bg-muted px-3 py-2 text-[12px] font-semibold text-brand opacity-40"
      >
        Create new AI agent
      </button>
      <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-muted-foreground">
        <span>Creating agents from the builder is not available yet.</span>
        <button type="button" onClick={() => p.env.refresh()} className="text-brand underline">
          Refresh list
        </button>
      </div>
    </Field>
  );
};
