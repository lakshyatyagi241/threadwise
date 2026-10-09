'use client';

import { useTranslations } from 'next-intl';
import { Field } from '../kit';
import type { FormComponent } from '../types';
import {
  AddLink,
  LeadForm,
  OrderDetailsFields,
  RemoveButton,
  RowInput,
  Ta,
  WhatsappHandoffForm,
  readRows,
} from './shared';

const NS = 'flb.builder.formsChannels.facebook';

/** Facebook Messenger limits: a generic-template carousel holds up to 10 elements. */
const MAX_CARDS = 10;

export const FbGalleryForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const cards = readRows(p.data.cards);
  const setC = (i: number, k: string, val: string) =>
    p.set(
      'cards',
      cards.map((c, j) => (j === i ? { ...c, [k]: val } : c)),
    );
  return (
    <>
      <Field label={t('intro')} hint={t('galleryIntroHint')}>
        {Ta(p, 'intro', '', 2)}
      </Field>
      <Field label={t('cards', { max: MAX_CARDS })} hint={t('cardsHint')}>
        {cards.map((c, i) => (
          <div key={i} className="mb-2 space-y-1.5 rounded-lg border border-border p-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">
                {t('card', { n: i + 1 })}
              </span>
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
            <RowInput
              value={c.title}
              onChange={(v) => setC(i, 'title', v)}
              placeholder={t('title')}
            />
            <RowInput
              value={c.subtitle}
              onChange={(v) => setC(i, 'subtitle', v)}
              placeholder={t('subtitle')}
            />
            <RowInput
              value={c.imageUrl}
              onChange={(v) => setC(i, 'imageUrl', v)}
              placeholder={t('imageUrl')}
            />
            <div className="flex gap-2">
              <RowInput
                value={c.buttonLabel}
                onChange={(v) => setC(i, 'buttonLabel', v)}
                placeholder={t('buttonLabel')}
                className="flex-1"
              />
              <RowInput
                value={c.buttonUrl}
                onChange={(v) => setC(i, 'buttonUrl', v)}
                placeholder={t('buttonUrl')}
                className="flex-1"
              />
            </div>
          </div>
        ))}
        {cards.length < MAX_CARDS ? (
          <AddLink
            onClick={() =>
              p.set(
                'cards',
                cards.concat([
                  { title: '', subtitle: '', imageUrl: '', buttonLabel: '', buttonUrl: '' },
                ]),
              )
            }
          >
            {t('addCard')}
          </AddLink>
        ) : null}
      </Field>
    </>
  );
};

export const FbProductsForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const items = readRows(p.data.products);
  const setP = (i: number, k: string, val: string) =>
    p.set(
      'products',
      items.map((it, j) => (j === i ? { ...it, [k]: val } : it)),
    );
  return (
    <>
      <Field label={t('intro')} hint={t('productsIntroHint')}>
        {Ta(p, 'intro', t('productsIntroPlaceholder'), 2)}
      </Field>
      <Field label={t('products', { max: MAX_CARDS })} hint={t('productsHint')}>
        {items.map((it, i) => (
          <div key={i} className="mb-2 space-y-1.5 rounded-lg border border-border p-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">
                {t('product', { n: i + 1 })}
              </span>
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
              placeholder={t('productName')}
            />
            <RowInput
              value={it.subtitle}
              onChange={(v) => setP(i, 'subtitle', v)}
              placeholder={t('priceDescription')}
            />
            <RowInput
              value={it.imageUrl}
              onChange={(v) => setP(i, 'imageUrl', v)}
              placeholder={t('imageUrl')}
            />
            <RowInput
              value={it.url}
              onChange={(v) => setP(i, 'url', v)}
              placeholder={t('productUrl')}
            />
          </div>
        ))}
        {items.length < MAX_CARDS ? (
          <AddLink
            onClick={() =>
              p.set('products', items.concat([{ title: '', subtitle: '', imageUrl: '', url: '' }]))
            }
          >
            {t('addProduct')}
          </AddLink>
        ) : null}
      </Field>
      <OrderDetailsFields p={p} detailsHint={t('detailsHint')} />
    </>
  );
};

export const FbLeadForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return <LeadForm p={p} askName={t('leadAskName')} />;
};

export const FbReplyCommentForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return (
    <Field label={t('publicReply')} hint={t('publicReplyHint')}>
      {Ta(p, 'text', t('replyPlaceholder'), 2)}
    </Field>
  );
};

export const FbToWhatsappForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return (
    <WhatsappHandoffForm
      p={p}
      platform="Facebook"
      surface={t('surface')}
      dmName={t('dmName')}
      // WaDesk's exclusion list: LINE, WeChat and Viber flows stay offered (QUIRK).
      excludeChannels={['instagram', 'facebook', 'tiktok', 'telegram', 'email']}
      prefillDefault={t('prefillDefault')}
    />
  );
};
