'use client';

import { useState } from 'react';
import { cn } from '@crm/ui';
import { useCommerceProducts } from '../../../api/hooks';
import { Field, controlClass } from '../kit';
import type { FormComponent } from '../types';
import {
  AddLink,
  LeadForm,
  Mono,
  OrderDetailsFields,
  RemoveButton,
  RowInput,
  Sel,
  Ta,
  Txt,
  WhatsappHandoffForm,
  aiModelOptions,
  knowledgeBaseOptions,
  readRows,
} from './shared';
import { formatPrice } from './helpers';

export const IgSendDmForm: FormComponent = (p) => (
  <Field label="Message" hint="The DM text. {{variables}} from earlier nodes are substituted.">
    {Ta(p, 'text', 'Hi! Thanks for your message.', 3)}
  </Field>
);

export const IgQuickForm: FormComponent = (p) => {
  const opts = readRows(p.data.options);
  const setOpt = (i: number, k: string, val: string) =>
    p.set(
      'options',
      opts.map((o, j) => (j === i ? { ...o, [k]: val } : o)),
    );
  return (
    <>
      <Field label="Message">{Ta(p, 'text', 'What can I help you with?', 2)}</Field>
      <Field
        label="Quick replies"
        hint="Each becomes an output port — wire the next node off the one they tap."
      >
        {opts.map((o, i) => (
          <div key={i} className="mb-1.5 flex items-center gap-2">
            <RowInput
              value={o.title}
              onChange={(v) => setOpt(i, 'title', v)}
              placeholder="Button label"
              className="flex-1"
            />
            <RowInput
              value={o.payload}
              onChange={(v) => setOpt(i, 'payload', v)}
              placeholder="PAYLOAD"
              mono
              className="w-1/3"
            />
            <RemoveButton
              onClick={() =>
                p.set(
                  'options',
                  opts.filter((_, j) => j !== i),
                )
              }
            />
          </div>
        ))}
        <AddLink onClick={() => p.set('options', opts.concat([{ title: '', payload: '' }]))}>
          Add quick reply
        </AddLink>
      </Field>
    </>
  );
};

export const IgButtonsForm: FormComponent = (p) => {
  const btns = readRows(p.data.buttons);
  const setB = (i: number, k: string, val: string) =>
    p.set(
      'buttons',
      btns.map((b, j) => (j === i ? { ...b, [k]: val } : b)),
    );
  return (
    <>
      <Field label="Message">{Ta(p, 'text', 'Tap a button below:', 2)}</Field>
      <Field label="Buttons (max 3)" hint="Instagram allows up to 3 buttons per message.">
        {btns.map((b, i) => {
          const type = b.type === 'postback' ? 'postback' : 'web_url';
          return (
            <div key={i} className="mb-2 rounded-lg border border-border p-2">
              <div className="mb-1 flex items-center gap-2">
                <select
                  value={String(b.type || 'web_url')}
                  onChange={(e) => setB(i, 'type', e.target.value)}
                  className={cn(controlClass, 'w-auto px-2 py-1 text-[12px]')}
                >
                  <option value="web_url">Open URL</option>
                  <option value="postback">Postback</option>
                </select>
                <RowInput
                  value={b.title}
                  onChange={(v) => setB(i, 'title', v)}
                  placeholder="Button label"
                  className="flex-1"
                />
                <RemoveButton
                  onClick={() =>
                    p.set(
                      'buttons',
                      btns.filter((_, j) => j !== i),
                    )
                  }
                />
              </div>
              {type === 'postback' ? (
                <RowInput
                  value={b.payload}
                  onChange={(v) => setB(i, 'payload', v)}
                  placeholder="PAYLOAD"
                  mono
                />
              ) : (
                <RowInput
                  value={b.url}
                  onChange={(v) => setB(i, 'url', v)}
                  placeholder="https://…"
                />
              )}
            </div>
          );
        })}
        {btns.length < 3 ? (
          <AddLink
            onClick={() => p.set('buttons', btns.concat([{ type: 'web_url', title: '', url: '' }]))}
          >
            Add button
          </AddLink>
        ) : null}
      </Field>
    </>
  );
};

export const IgReplyCommentForm: FormComponent = (p) => (
  <Field
    label="Public reply"
    hint="Posted as a public reply under the comment that triggered the flow."
  >
    {Ta(p, 'message', 'Thanks! Just sent you a DM.', 2)}
  </Field>
);

export const IgAiForm: FormComponent = (p) => (
  <>
    <Field label="Model">{Sel(p, 'model', aiModelOptions(p))}</Field>
    <Field label="Instructions (system prompt)">
      {Ta(p, 'prompt', 'You are our friendly Instagram assistant. Answer briefly.', 4)}
    </Field>
    <Field
      label="Knowledge base (optional)"
      hint="Attach a trained assistant from AI Training to answer from your content."
    >
      {Sel(p, 'assistant', knowledgeBaseOptions(p))}
    </Field>
    <Field label="Save reply to">{Txt(p, 'save', 'ai_reply')}</Field>
  </>
);

/**
 * Inline picker for the Instagram "Send products" node: a searchable multi-select over the synced catalog. The selection
 * is a list of the products' retailer ids, in the order they were tapped (that is the order they are sent).
 */
function IgProductPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const products = useCommerceProducts({ provider: 'instagram', limit: 100 });
  const list = products.data?.data ?? [];
  const query = q.trim().toLowerCase();
  const filtered = query ? list.filter((p) => p.name.toLowerCase().includes(query)) : list;
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search products…"
        className={cn(controlClass, 'mb-2 px-2.5 py-1.5 text-[12px]')}
      />
      {products.isPending ? (
        <div className="py-3 text-center text-[12px] italic text-muted-foreground">
          Loading synced products…
        </div>
      ) : null}
      {products.isError ? (
        <div className="py-2 text-[12px] text-red-600">
          Couldn&apos;t load: {products.error.message}
        </div>
      ) : null}
      {products.isSuccess && list.length === 0 ? (
        <div className="py-3 text-center text-[12px] italic leading-snug text-muted-foreground">
          No products synced yet.
          <br />
          Sync your catalog on the Instagram Commerce page first.
        </div>
      ) : null}
      <div className="grid max-h-[220px] grid-cols-2 gap-1.5 overflow-y-auto">
        {filtered.map((pr) => {
          const on = value.includes(pr.retailerId);
          return (
            <button
              key={pr.retailerId}
              type="button"
              onClick={() => toggle(pr.retailerId)}
              className={cn(
                'flex items-center gap-2 rounded-lg border p-1.5 text-left transition',
                on ? 'border-brand bg-brand/10' : 'border-border bg-background hover:bg-muted',
              )}
            >
              {pr.image ? (
                <img
                  src={pr.image}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded border border-border object-cover"
                />
              ) : (
                <div className="h-8 w-8 shrink-0 rounded border border-border bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] font-medium">{pr.name}</div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {formatPrice(pr.currency, pr.priceMinor)}
                </div>
              </div>
              {on ? <span className="text-[11px] text-brand">✓</span> : null}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 text-[10.5px] text-muted-foreground">
        {value.length} selected · sent in this order
      </div>
    </div>
  );
}

function Seg({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-[12px] font-medium transition',
        on
          ? 'border-brand bg-brand/10 text-brand'
          : 'border-border bg-background text-foreground/70 hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

export const IgProductsForm: FormComponent = (p) => {
  const sel = p.data.selection === 'all' ? 'all' : 'pick';
  const ids = Array.isArray(p.data.productIds) ? p.data.productIds.map(String) : [];
  return (
    <>
      <Field label="Which products">
        <div className="flex gap-2">
          <Seg on={sel === 'pick'} onClick={() => p.set('selection', 'pick')}>
            Pick specific
          </Seg>
          <Seg on={sel === 'all'} onClick={() => p.set('selection', 'all')}>
            First N synced
          </Seg>
        </div>
      </Field>
      {sel === 'all' ? (
        <Field label="How many" hint="Sends your most recently-synced products (max 10).">
          {Txt(p, 'limit', '5')}
        </Field>
      ) : (
        <Field label="Products" hint="Tap to add / remove. They send in the order shown.">
          <IgProductPicker value={ids} onChange={(next) => p.set('productIds', next)} />
        </Field>
      )}
      <Field
        label="Intro message (optional)"
        hint="Sent as a DM just before the carousel. Leave blank to send only the cards."
      >
        {Ta(p, 'intro', 'Here are some products you might like:', 2)}
      </Field>
      <OrderDetailsFields
        p={p}
        detailsHint="Only appears on products that have a link in your catalog."
      />
    </>
  );
};

export const IgAskForm: FormComponent = (p) => {
  const save = String(p.data.save || 'lead_name');
  return (
    <>
      <Field
        label="Question"
        hint="Sent as a DM. The next reply the customer sends is captured as the answer."
      >
        {Ta(p, 'question', 'What is your name?', 2)}
      </Field>
      <Field
        label="Save answer to variable"
        hint={
          <>
            Reuse it later as <Mono>{`{{${save}}}`}</Mono> — e.g. in the Capture lead node.
          </>
        }
      >
        {Txt(p, 'save', 'lead_name')}
      </Field>
    </>
  );
};

export const IgLeadForm: FormComponent = (p) => <LeadForm p={p} askName="Ask a question" />;

export const IgToWhatsappForm: FormComponent = (p) => (
  <WhatsappHandoffForm
    p={p}
    platform="Instagram"
    surface="Instagram conversation"
    dmName="IG"
    excludeChannels={['instagram']}
    prefillDefault="Hi! I came from Instagram"
  />
);
