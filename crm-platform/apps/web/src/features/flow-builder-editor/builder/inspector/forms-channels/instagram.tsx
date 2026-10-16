'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { useCommerceProducts } from '../../../api/hooks';
import { Field, KnowledgeBaseActions, controlClass } from '../kit';
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

const NS = 'flb.builder.formsChannels.instagram';

export const IgSendDmForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return (
    <Field label={t('message')} hint={t('sendDmHint')}>
      {Ta(p, 'text', t('sendDmPlaceholder'), 3)}
    </Field>
  );
};

export const IgQuickForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const opts = readRows(p.data.options);
  const setOpt = (i: number, k: string, val: string) =>
    p.set(
      'options',
      opts.map((o, j) => (j === i ? { ...o, [k]: val } : o)),
    );
  return (
    <>
      <Field label={t('message')}>{Ta(p, 'text', t('quickPlaceholder'), 2)}</Field>
      <Field label={t('quickReplies')} hint={t('quickRepliesHint')}>
        {opts.map((o, i) => (
          <div key={i} className="mb-1.5 flex items-center gap-2">
            <RowInput
              value={o.title}
              onChange={(v) => setOpt(i, 'title', v)}
              placeholder={t('buttonLabel')}
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
          {t('addQuickReply')}
        </AddLink>
      </Field>
    </>
  );
};

export const IgButtonsForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const btns = readRows(p.data.buttons);
  const setB = (i: number, k: string, val: string) =>
    p.set(
      'buttons',
      btns.map((b, j) => (j === i ? { ...b, [k]: val } : b)),
    );
  return (
    <>
      <Field label={t('message')}>{Ta(p, 'text', t('buttonsPlaceholder'), 2)}</Field>
      <Field label={t('buttons')} hint={t('buttonsHint')}>
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
                  <option value="web_url">{t('openUrl')}</option>
                  <option value="postback">{t('postback')}</option>
                </select>
                <RowInput
                  value={b.title}
                  onChange={(v) => setB(i, 'title', v)}
                  placeholder={t('buttonLabel')}
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
            {t('addButton')}
          </AddLink>
        ) : null}
      </Field>
    </>
  );
};

export const IgReplyCommentForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return (
    <Field label={t('publicReply')} hint={t('publicReplyHint')}>
      {Ta(p, 'message', t('replyPlaceholder'), 2)}
    </Field>
  );
};

export const IgAiForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const ts = useTranslations('flb.builder.formsChannels.shared');
  return (
    <>
      <Field label={t('model')}>{Sel(p, 'model', aiModelOptions(p, ts))}</Field>
      <Field label={t('instructions')}>{Ta(p, 'prompt', t('aiPromptPlaceholder'), 4)}</Field>
      <Field label={t('knowledgeBase')} hint={t('knowledgeBaseHint')}>
        {Sel(p, 'assistant', knowledgeBaseOptions(p, ts))}
        <KnowledgeBaseActions refresh={() => p.env.refresh()} />
      </Field>
      <Field label={t('saveReply')}>{Txt(p, 'save', 'ai_reply')}</Field>
    </>
  );
};

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
  const t = useTranslations(NS);
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
        placeholder={t('searchProducts')}
        className={cn(controlClass, 'mb-2 px-2.5 py-1.5 text-[12px]')}
      />
      {products.isPending ? (
        <div className="py-3 text-center text-[12px] italic text-muted-foreground">
          {t('loadingSynced')}
        </div>
      ) : null}
      {products.isError ? (
        <div className="py-2 text-[12px] text-red-600">
          {t('loadFailed', { message: products.error.message })}
        </div>
      ) : null}
      {products.isSuccess && list.length === 0 ? (
        <div className="py-3 text-center text-[12px] italic leading-snug text-muted-foreground">
          {t('noSyncedTitle')}
          <br />
          {t('noSyncedHint')}
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
                'flex items-center gap-2 rounded-lg border p-1.5 text-start transition',
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
        {t('selectedInOrder', { count: value.length })}
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
  const t = useTranslations(NS);
  const sel = p.data.selection === 'all' ? 'all' : 'pick';
  const ids = Array.isArray(p.data.productIds) ? p.data.productIds.map(String) : [];
  return (
    <>
      <Field label={t('whichProducts')}>
        <div className="flex gap-2">
          <Seg on={sel === 'pick'} onClick={() => p.set('selection', 'pick')}>
            {t('pickSpecific')}
          </Seg>
          <Seg on={sel === 'all'} onClick={() => p.set('selection', 'all')}>
            {t('firstN')}
          </Seg>
        </div>
      </Field>
      {sel === 'all' ? (
        <Field label={t('howMany')} hint={t('howManyHint')}>
          {Txt(p, 'limit', '5')}
        </Field>
      ) : (
        <Field label={t('products')} hint={t('productsHint')}>
          <IgProductPicker value={ids} onChange={(next) => p.set('productIds', next)} />
        </Field>
      )}
      <Field label={t('intro')} hint={t('introHint')}>
        {Ta(p, 'intro', t('introPlaceholder'), 2)}
      </Field>
      <OrderDetailsFields p={p} detailsHint={t('detailsHint')} />
    </>
  );
};

export const IgAskForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const save = String(p.data.save || 'lead_name');
  return (
    <>
      <Field label={t('question')} hint={t('questionHint')}>
        {Ta(p, 'question', t('questionPlaceholder'), 2)}
      </Field>
      <Field
        label={t('saveAnswer')}
        hint={t.rich('saveAnswerHint', {
          token: `{{${save}}}`,
          mono: (c) => <Mono>{c}</Mono>,
        })}
      >
        {Txt(p, 'save', 'lead_name')}
      </Field>
    </>
  );
};

export const IgLeadForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return <LeadForm p={p} askName={t('leadAskName')} />;
};

export const IgToWhatsappForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return (
    <WhatsappHandoffForm
      p={p}
      platform="Instagram"
      surface={t('surface')}
      dmName={t('dmName')}
      excludeChannels={['instagram']}
      prefillDefault={t('prefillDefault')}
    />
  );
};
