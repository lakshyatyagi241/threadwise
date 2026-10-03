'use client';

import { AddButton, Field } from '../kit';
import type { FormComponent } from '../types';
import {
  LeadForm,
  OrderDetailsFields,
  RemoveButton,
  RowInput,
  Ta,
  WhatsappHandoffForm,
  readRows,
} from './shared';

/** Facebook Messenger limits: a generic-template carousel holds up to 10 elements. */
const MAX_CARDS = 10;

export const FbGalleryForm: FormComponent = (p) => {
  const cards = readRows(p.data.cards);
  const setC = (i: number, k: string, val: string) =>
    p.set(
      'cards',
      cards.map((c, j) => (j === i ? { ...c, [k]: val } : c)),
    );
  return (
    <>
      <Field
        label="Intro message (optional)"
        hint="Sent as a DM just before the carousel. Leave blank to send only the cards."
      >
        {Ta(p, 'intro', '', 2)}
      </Field>
      <Field
        label="Cards (max 10)"
        hint="A Messenger generic-template carousel. Each card shows an image, title, subtitle and an optional URL button."
      >
        {cards.map((c, i) => (
          <div key={i} className="mb-2 space-y-1.5 rounded-lg border border-border p-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">Card {i + 1}</span>
              <span className="ml-auto">
                <RemoveButton
                  onClick={() =>
                    p.set(
                      'cards',
                      cards.filter((_, j) => j !== i),
                    )
                  }
                />
              </span>
            </div>
            <RowInput value={c.title} onChange={(v) => setC(i, 'title', v)} placeholder="Title" />
            <RowInput
              value={c.subtitle}
              onChange={(v) => setC(i, 'subtitle', v)}
              placeholder="Subtitle (optional)"
            />
            <RowInput
              value={c.imageUrl}
              onChange={(v) => setC(i, 'imageUrl', v)}
              placeholder="Image URL (https://…)"
            />
            <div className="flex gap-2">
              <RowInput
                value={c.buttonLabel}
                onChange={(v) => setC(i, 'buttonLabel', v)}
                placeholder="Button label"
                className="flex-1"
              />
              <RowInput
                value={c.buttonUrl}
                onChange={(v) => setC(i, 'buttonUrl', v)}
                placeholder="Button URL"
                className="flex-1"
              />
            </div>
          </div>
        ))}
        {cards.length < MAX_CARDS ? (
          <AddButton
            onClick={() =>
              p.set(
                'cards',
                cards.concat([
                  { title: '', subtitle: '', imageUrl: '', buttonLabel: '', buttonUrl: '' },
                ]),
              )
            }
          >
            Add card
          </AddButton>
        ) : null}
      </Field>
    </>
  );
};

export const FbProductsForm: FormComponent = (p) => {
  const items = readRows(p.data.products);
  const setP = (i: number, k: string, val: string) =>
    p.set(
      'products',
      items.map((it, j) => (j === i ? { ...it, [k]: val } : it)),
    );
  return (
    <>
      <Field label="Intro message (optional)" hint="Sent as a DM just before the product carousel.">
        {Ta(p, 'intro', 'Here are some products you might like:', 2)}
      </Field>
      <Field label="Products (max 10)" hint="Sends as a Messenger shoppable carousel.">
        {items.map((it, i) => (
          <div key={i} className="mb-2 space-y-1.5 rounded-lg border border-border p-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">Product {i + 1}</span>
              <span className="ml-auto">
                <RemoveButton
                  onClick={() =>
                    p.set(
                      'products',
                      items.filter((_, j) => j !== i),
                    )
                  }
                />
              </span>
            </div>
            <RowInput
              value={it.title}
              onChange={(v) => setP(i, 'title', v)}
              placeholder="Product name"
            />
            <RowInput
              value={it.subtitle}
              onChange={(v) => setP(i, 'subtitle', v)}
              placeholder="Price / description (optional)"
            />
            <RowInput
              value={it.imageUrl}
              onChange={(v) => setP(i, 'imageUrl', v)}
              placeholder="Image URL (https://…)"
            />
            <RowInput
              value={it.url}
              onChange={(v) => setP(i, 'url', v)}
              placeholder="Product page URL (for the View button)"
            />
          </div>
        ))}
        {items.length < MAX_CARDS ? (
          <AddButton
            onClick={() =>
              p.set('products', items.concat([{ title: '', subtitle: '', imageUrl: '', url: '' }]))
            }
          >
            Add product
          </AddButton>
        ) : null}
      </Field>
      <OrderDetailsFields p={p} detailsHint="Only appears on products that have a URL." />
    </>
  );
};

export const FbLeadForm: FormComponent = (p) => <LeadForm p={p} askName="Ask question" />;

export const FbReplyCommentForm: FormComponent = (p) => (
  <Field
    label="Public reply"
    hint="Posted as a public reply under the comment that triggered the flow."
  >
    {Ta(p, 'text', 'Thanks! Just sent you a DM.', 2)}
  </Field>
);

export const FbToWhatsappForm: FormComponent = (p) => (
  <WhatsappHandoffForm
    p={p}
    platform="Facebook"
    surface="Messenger conversation"
    dmName="Messenger"
    // WaDesk's exclusion list: LINE, WeChat and Viber flows stay offered (QUIRK).
    excludeChannels={['instagram', 'facebook', 'tiktok', 'telegram', 'email']}
    prefillDefault="Hi! I came from Facebook"
  />
);
