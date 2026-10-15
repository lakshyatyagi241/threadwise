'use client';

import {
  FLB_CAROUSEL_LIMITS,
  FLB_CAROUSEL_MAX_BUTTONS,
  FLB_CAROUSEL_MAX_CARDS,
} from '@crm/contracts';
import { useTranslations } from 'next-intl';
import {
  AddButton,
  Field,
  IconButton,
  RowCard,
  SelectInput,
  TextArea,
  TextInput,
  XIcon,
} from '../kit';
import type { FormProps } from '../types';
import { acceptFor } from './helpers';
import { UploadBox, UploadedFile, uploadFile } from './parts';
import { ChoiceVariableField } from './save-to-attribute';

const KINDS = ['reply', 'agent', 'url', 'phone', 'email'] as const;

type Card = {
  image: string;
  title: string;
  text: string;
  buttons: Array<{ type: string; label: string; value: string; team: string; note: string }>;
};

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

const cardsOf = (raw: unknown): Card[] =>
  (Array.isArray(raw) ? raw : []).map((c) => {
    const r = (c ?? {}) as Record<string, unknown>;
    return {
      image: str(r.image),
      title: str(r.title),
      text: str(r.text),
      buttons: (Array.isArray(r.buttons) ? r.buttons : []).map((b) => {
        const x = (b ?? {}) as Record<string, unknown>;
        return {
          type: str(x.type) || 'reply',
          label: str(x.label),
          value: str(x.value),
          team: str(x.team),
          note: str(x.note),
        };
      }),
    };
  });

/**
 * The Carousel node of a website chat bot: cards with a picture, a title, a line of text and up to two buttons. Each "reply in chat"
 * button is an exit of the node (drawn on the canvas, in card order); the other kinds open a page, a call or an email.
 */
export function CarouselForm({ data: d, set, env }: FormProps) {
  const t = useTranslations('flb.builder.simple.editors.carousel');
  const tu = useTranslations('flb.builder.formsCore.send');
  const tp = useTranslations('flb.builder.formsCore.parts');
  const cards = cardsOf(d.cards);
  const save = (next: Card[]) => set('cards', next);
  const patch = (i: number, p: Partial<Card>) =>
    save(cards.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <>
      <Field label={t('intro')}>
        <TextArea value={d.text} rows={2} onChange={(v) => set('text', v)} />
      </Field>
      {cards.map((c, i) => (
        <RowCard key={i} className="p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11.5px] font-semibold">{t('card', { n: i + 1 })}</span>
            <IconButton
              title={t('removeCard')}
              danger
              disabled={cards.length <= 1}
              onClick={() => save(cards.filter((_, j) => j !== i))}
            >
              <XIcon />
            </IconButton>
          </div>
          <Field label={t('image')}>
            <UploadBox
              compact
              accept={acceptFor('image')}
              label={c.image ? tu('replaceFile') : tu('chooseKind.image')}
              onFile={(file) =>
                uploadFile(tp, env, file, 'image', (res) => patch(i, { image: res.url }))
              }
            />
            <div className="mt-2">
              <TextInput
                value={c.image}
                placeholder="https://"
                onChange={(v) => patch(i, { image: v })}
              />
            </div>
            {c.image ? <UploadedFile kind="image" url={c.image} filename="" size="sm" /> : null}
          </Field>
          <Field label={`${t('title')} (${c.title.length}/${FLB_CAROUSEL_LIMITS.title})`}>
            <TextInput value={c.title} onChange={(v) => patch(i, { title: v })} />
          </Field>
          <Field label={`${t('text')} (${c.text.length}/${FLB_CAROUSEL_LIMITS.text})`}>
            <TextArea value={c.text} rows={2} onChange={(v) => patch(i, { text: v })} />
          </Field>
          <Field label={t('buttons')}>
            {c.buttons.map((b, k) => (
              <div key={k} className="mb-2 rounded-lg border border-border p-2">
                <div className="mb-1.5 flex items-center gap-2">
                  <div className="flex-1">
                    <SelectInput
                      value={b.type}
                      options={KINDS.map((x) => ({ v: x, l: t(`btnKinds.${x}`) }))}
                      onChange={(v) =>
                        patch(i, {
                          buttons: c.buttons.map((y, j) => (j === k ? { ...y, type: v } : y)),
                        })
                      }
                    />
                  </div>
                  <IconButton
                    title={t('removeButton')}
                    danger
                    onClick={() => patch(i, { buttons: c.buttons.filter((_, j) => j !== k) })}
                  >
                    <XIcon />
                  </IconButton>
                </div>
                <TextInput
                  value={b.label}
                  placeholder={t('label')}
                  onChange={(v) =>
                    patch(i, {
                      buttons: c.buttons.map((y, j) => (j === k ? { ...y, label: v } : y)),
                    })
                  }
                />
                {b.type === 'agent' ? (
                  <div className="mt-1.5 space-y-1.5">
                    <SelectInput
                      value={b.team}
                      options={[
                        { v: '', l: '—' },
                        ...env.ctx.teams.map((tm) => ({ v: tm.id, l: tm.name })),
                      ]}
                      onChange={(v) =>
                        patch(i, {
                          buttons: c.buttons.map((y, j) => (j === k ? { ...y, team: v } : y)),
                        })
                      }
                    />
                    <TextInput
                      value={b.note}
                      onChange={(v) =>
                        patch(i, {
                          buttons: c.buttons.map((y, j) => (j === k ? { ...y, note: v } : y)),
                        })
                      }
                    />
                  </div>
                ) : null}
                {b.type !== 'reply' && b.type !== 'agent' ? (
                  <div className="mt-1.5">
                    <TextInput
                      value={b.value}
                      placeholder={
                        b.type === 'phone'
                          ? '+91 98765 43210'
                          : b.type === 'email'
                            ? 'name@example.com'
                            : 'https://'
                      }
                      onChange={(v) =>
                        patch(i, {
                          buttons: c.buttons.map((y, j) => (j === k ? { ...y, value: v } : y)),
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
            ))}
            {c.buttons.length < FLB_CAROUSEL_MAX_BUTTONS ? (
              <AddButton
                onClick={() =>
                  patch(i, {
                    buttons: [
                      ...c.buttons,
                      { type: 'reply', label: '', value: '', team: '', note: '' },
                    ],
                  })
                }
              >
                {t('addButton')}
              </AddButton>
            ) : null}
          </Field>
        </RowCard>
      ))}
      {cards.length < FLB_CAROUSEL_MAX_CARDS ? (
        <AddButton
          onClick={() =>
            save([
              ...cards,
              {
                image: '',
                title: '',
                text: '',
                buttons: [{ type: 'url', label: '', value: '', team: '', note: '' }],
              },
            ])
          }
        >
          {t('addCard')}
        </AddButton>
      ) : null}
      <ChoiceVariableField data={d} set={set} />
    </>
  );
}
