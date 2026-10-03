'use client';

import { AddButton, Check, Field, NumberInput } from '../kit';
import type { FormComponent } from '../types';
import {
  RemoveButton,
  RowInput,
  Sel,
  Ta,
  Txt,
  aiModelOptions,
  knowledgeBaseOptions,
  readRows,
  voiceAssistantOptions,
} from './shared';

export const CfSayForm: FormComponent = (p) => (
  <Field label="Say to caller" hint="Spoken aloud (text-to-speech). {{variables}} are substituted.">
    {Ta(p, 'text', 'Hello! Thanks for calling.', 3)}
  </Field>
);

export const CfListenForm: FormComponent = (p) => {
  const save = String(p.data.save || 'caller_said');
  return (
    <>
      <Field
        label="Save what they say to"
        hint={`The caller's words are transcribed and stored here, e.g. {{${save}}}.`}
      >
        {Txt(p, 'save', 'caller_said')}
      </Field>
      <Field label="Stop after silence (seconds)" hint="How long to wait for them to finish talking before moving on.">
        <NumberInput
          value={p.data.silenceTimeout ?? 6}
          min={1}
          max={30}
          onChange={(v) => p.set('silenceTimeout', Number.isNaN(v) || v === 0 ? 6 : Math.trunc(v))}
        />
      </Field>
    </>
  );
};

export const CfAiForm: FormComponent = (p) => (
  <>
    <Field label="Model">{Sel(p, 'model', aiModelOptions(p))}</Field>
    <Field label="Instructions (system prompt)">
      {Ta(p, 'prompt', 'You are a helpful phone assistant. Keep answers short and natural.', 4)}
    </Field>
    <Field
      label="Knowledge base (optional)"
      hint="Attach a trained assistant from AI Training to answer from your content."
    >
      {Sel(p, 'assistant', knowledgeBaseOptions(p))}
    </Field>
    <Field label="Save spoken reply to">{Txt(p, 'save', 'ai_reply')}</Field>
    <Check checked={!!p.data.endOnGoodbye} onChange={(v) => p.set('endOnGoodbye', v)}>
      End the call when the caller says goodbye
    </Check>
  </>
);

export const CfAssistantForm: FormComponent = (p) => (
  <>
    <Field
      label="Voice assistant"
      hint="The AI voice agent that answers this turn — its own persona + model reply, spoken back. Put a Listen node before it to make it conversational."
    >
      {Sel(p, 'assistant', voiceAssistantOptions(p, 'assistant', '— pick a voice assistant —'))}
    </Field>
    <Field label="Extra instructions (optional)" hint="Appended to the assistant persona for this node only.">
      {Ta(p, 'prompt', '', 3)}
    </Field>
    <Field label="Save spoken reply to">{Txt(p, 'save', 'assistant_reply')}</Field>
    <Check checked={!!p.data.endOnGoodbye} onChange={(v) => p.set('endOnGoodbye', v)}>
      End the call when the caller says goodbye
    </Check>
  </>
);

export const CfMenuForm: FormComponent = (p) => {
  const opts = readRows(p.data.options);
  const setOpt = (i: number, k: string, val: string) =>
    p.set(
      'options',
      opts.map((o, j) => (j === i ? { ...o, [k]: val } : o)),
    );
  return (
    <>
      <Field label="Route by">
        {Sel(p, 'mode', [
          { v: 'intent', l: 'What the caller says (AI intent)' },
          { v: 'keyword', l: 'Keyword match' },
          { v: 'digit', l: 'Key press (1,2,3…)' },
        ])}
      </Field>
      <Field
        label="Branches"
        hint={'Each branch becomes an output port. Unmatched calls take the "no match" port.'}
      >
        {opts.map((o, i) => (
          <div key={i} className="mb-1.5 flex items-center gap-2">
            <RowInput
              value={o.match}
              onChange={(v) => setOpt(i, 'match', v)}
              placeholder={p.data.mode === 'digit' ? '1' : 'sales'}
              className="w-1/3"
            />
            <RowInput value={o.label} onChange={(v) => setOpt(i, 'label', v)} placeholder="Branch label" className="flex-1" />
            <RemoveButton onClick={() => p.set('options', opts.filter((_, j) => j !== i))} />
          </div>
        ))}
        <AddButton onClick={() => p.set('options', opts.concat([{ match: '', label: '' }]))}>Add branch</AddButton>
      </Field>
    </>
  );
};

export const CfSearchForm: FormComponent = (p) => {
  const save = String(p.data.save || 'search');
  return (
    <>
      <Field label="Search query" hint="What to look up. Use {{variables}} from earlier nodes.">
        {Txt(p, 'query', '{{caller_said}}')}
      </Field>
      <Field label="Save results to" hint={`Usually fed into the next AI Respond node via {{${save}}}.`}>
        {Txt(p, 'save', 'search')}
      </Field>
      <Field
        label="Say while searching"
        hint="Spoken immediately so the caller never hears silence while the lookup runs."
      >
        {Txt(p, 'filler', 'One moment, let me check that…')}
      </Field>
    </>
  );
};

export const CfTransferForm: FormComponent = (p) => (
  <>
    <Field label="Transfer to number" hint="The call is bridged to this number (agent / queue).">
      {Txt(p, 'number', '+1555…')}
    </Field>
    <Field label="Say before transferring">{Txt(p, 'message', 'Connecting you to an agent now.')}</Field>
  </>
);

export const CfHangupForm: FormComponent = (p) => (
  <Field label="Goodbye message" hint="Spoken just before the call ends. Leave blank to hang up silently.">
    {Txt(p, 'goodbye', 'Thanks for calling. Goodbye!')}
  </Field>
);
