'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@crm/ui';
import { uploadTemplateMedia } from '../api/media';
import { BUTTON_TEXT_MAX, newRow, type AddableKind, type ButtonRow } from '../lib/buttons';
import {
  CARDS_MAX,
  CARDS_MIN,
  CARD_BODY_MAX,
  CARD_BUTTONS_MAX,
  hasCardFile,
  newCard,
  type CardFormat,
  type CardRow,
} from '../lib/form-model';
import { toggleSelection } from '../lib/format';
import { MEDIA_ACCEPT, MEDIA_MAX_BYTES, mediaProblem, megabytes } from '../lib/media';
import { ErrorAlert } from './error-line';
import { ArrowDownIcon, ArrowUpIcon, ImageIcon, PlusIcon, TrashIcon, VideoIcon } from './icons';
import { useUploadErrorText } from './use-error-text';

/** The button kinds a card can carry (Meta: a quick reply, a link or a phone number; up to two, the same on every card). */
const CARD_KINDS: readonly AddableKind[] = ['quick_reply', 'url', 'phone'];

/** The marks a card's text takes, as the message body takes them. */
const CARD_MARKS = [
  { id: 'bold', marker: '*' },
  { id: 'italic', marker: '_' },
  { id: 'strike', marker: '~' },
  { id: 'code', marker: '```' },
] as const;

/**
 * A carousel's cards: 2 to 10, each a picture or video (one kind for all), a short text and up to two buttons. The files go to Meta
 * the same way a header sample does and are kept in the workspace's storage for the sends.
 */
export function CardsEditor({
  connectionId,
  format,
  cards,
  onFormat,
  onChange,
}: {
  connectionId: string;
  format: CardFormat;
  cards: CardRow[];
  onFormat: (f: CardFormat) => void;
  onChange: (cards: CardRow[]) => void;
}) {
  const t = useTranslations('message-templates.form.cards');
  const base = useId();
  const patch = (key: string, p: Partial<CardRow>) =>
    onChange(cards.map((c) => (c.key === key ? { ...c, ...p } : c)));
  /** Swaps a card with its neighbour: the order here is the order the customer swipes through. */
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= cards.length) return;
    const next = [...cards];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('format')} htmlFor={`${base}-format`}>
          <Select
            id={`${base}-format`}
            value={format}
            onChange={(e) => onFormat(e.target.value as CardFormat)}
          >
            <option value="image">{t('formatImage')}</option>
            <option value="video">{t('formatVideo')}</option>
          </Select>
        </Field>
        <span className="ms-auto pb-2 text-xs text-muted-foreground" aria-live="polite">
          {t('count', { used: cards.length, max: CARDS_MAX })}
        </span>
      </div>

      <ol className="space-y-4">
        {cards.map((c, i) => (
          <CardItem
            key={c.key}
            n={i + 1}
            card={c}
            connectionId={connectionId}
            removable={cards.length > CARDS_MIN}
            onMove={(by) => move(i, by)}
            canMoveUp={i > 0}
            canMoveDown={i < cards.length - 1}
            onPatch={(p) => patch(c.key, p)}
            onRemove={() => onChange(cards.filter((x) => x.key !== c.key))}
          />
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={cards.length >= CARDS_MAX}
          onClick={() => onChange([...cards, newCard(format)])}
        >
          <PlusIcon className="size-3.5" />
          {t('add')}
        </Button>
        {cards.length < CARDS_MIN && (
          <span className="text-xs text-danger">{t('needTwo', { min: CARDS_MIN })}</span>
        )}
      </div>
    </div>
  );
}

function CardItem({
  n,
  card,
  connectionId,
  removable,
  onMove,
  canMoveUp,
  canMoveDown,
  onPatch,
  onRemove,
}: {
  n: number;
  card: CardRow;
  connectionId: string;
  removable: boolean;
  onMove: (by: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPatch: (p: Partial<CardRow>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('message-templates.form.cards');
  const th = useTranslations('message-templates.form.header');
  const tb = useTranslations('message-templates.form.buttons');
  const errorText = useUploadErrorText();
  const base = useId();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => uploadTemplateMedia(file, connectionId),
    onSuccess: (r) =>
      onPatch({
        handle: r.handle,
        fileName: r.fileName,
        mediaKey: r.mediaKey,
        previewUrl: r.previewUrl,
      }),
  });
  const kind = card.format;
  const Icon = kind === 'video' ? VideoIcon : ImageIcon;
  const tf = useTranslations('message-templates.form.body');
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // The marks of the message body (bold, italic, strikethrough, code), applied to this card's text the same way.
  function mark(marker: string) {
    const el = bodyRef.current;
    if (!el) return;
    const r = toggleSelection(
      card.body,
      el.selectionStart,
      el.selectionEnd,
      marker,
      tf('wrapSample'),
    );
    onPatch({ body: r.value });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.start, r.end);
    });
  }

  function pick(file: File | undefined) {
    if (!file) return;
    const p = mediaProblem(kind, file);
    if (p) {
      setProblem(
        p === 'tooBig'
          ? th('tooBig', {
              size: megabytes(file.size),
              max: megabytes(MEDIA_MAX_BYTES[kind]),
              kind: th(`kind.${kind}`),
            })
          : th(p === 'wrongType' ? 'wrongType' : 'emptyFile'),
      );
      return;
    }
    setProblem(null);
    upload.mutate(file);
  }

  const setButton = (key: string, p: Partial<ButtonRow>) =>
    onPatch({ buttons: card.buttons.map((b) => (b.key === key ? { ...b, ...p } : b)) });

  return (
    <li className="rounded-md border border-border p-3" data-testid="card-row">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('card', { n })}
        </span>
        <div className="ms-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('moveUp', { n })}
            title={t('moveUp', { n })}
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('moveDown', { n })}
            title={t('moveDown', { n })}
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon className="size-3.5" />
          </Button>
          {removable && (
            <Button size="sm" variant="ghost" aria-label={t('remove', { n })} onClick={onRemove}>
              <TrashIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border p-3">
          {card.previewUrl && kind === 'image' ? (
            <img src={card.previewUrl} alt="" className="size-14 rounded object-cover" />
          ) : (
            <Icon className="size-6 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1 text-sm">
            {upload.isPending ? (
              <span className="flex items-center gap-2">
                <Spinner /> {t('uploading')}
              </span>
            ) : card.fileName ? (
              <span className="break-all">{card.fileName}</span>
            ) : hasCardFile(card) ? (
              <span className="text-muted-foreground">{th('keptSample')}</span>
            ) : (
              <span className="text-muted-foreground">{t('noFile')}</span>
            )}
            <p className="text-xs text-muted-foreground">{t('limits')}</p>
          </div>
          <input
            ref={input}
            id={`${base}-file`}
            type="file"
            className="sr-only"
            accept={MEDIA_ACCEPT[kind]}
            aria-label={t('card', { n })}
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={upload.isPending || !connectionId}
            onClick={() => input.current?.click()}
          >
            {hasCardFile(card) ? th('replace') : th('choose')}
          </Button>
        </div>
        {problem && <Alert tone="danger">{problem}</Alert>}
        {upload.isError && <ErrorAlert error={errorText(upload.error, kind)} />}

        <div className="flex flex-wrap gap-1.5">
          {CARD_MARKS.map((m) => (
            <Button key={m.id} size="sm" variant="secondary" onClick={() => mark(m.marker)}>
              {tf(`format.${m.id}`)}
            </Button>
          ))}
        </div>
        <Field
          label={t('text')}
          htmlFor={`${base}-body`}
          hint={t('textCounter', { used: card.body.length, max: CARD_BODY_MAX })}
        >
          <Textarea
            id={`${base}-body`}
            ref={bodyRef}
            rows={2}
            value={card.body}
            maxLength={CARD_BODY_MAX + 40}
            onChange={(e) => onPatch({ body: e.target.value })}
          />
        </Field>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{t('buttons')}</span>
            {CARD_KINDS.map((k) => (
              <Button
                key={k}
                size="sm"
                variant="secondary"
                disabled={card.buttons.length >= CARD_BUTTONS_MAX}
                onClick={() => onPatch({ buttons: [...card.buttons, newRow(k)] })}
              >
                <PlusIcon className="size-3.5" />
                {tb(`add.${k}`)}
              </Button>
            ))}
          </div>
          {card.buttons.map((b) => (
            <div key={b.key} className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end">
              <span className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tb(`kind.${b.kind}`)}
              </span>
              <Field
                label={t('buttonText')}
                htmlFor={`${base}-${b.key}-t`}
                hint={t('textCounter', { used: b.text.length, max: BUTTON_TEXT_MAX })}
                error={
                  b.text.trim().length > BUTTON_TEXT_MAX
                    ? tb('issue.textTooLong', { max: BUTTON_TEXT_MAX })
                    : undefined
                }
              >
                <Input
                  id={`${base}-${b.key}-t`}
                  value={b.text}
                  maxLength={BUTTON_TEXT_MAX + 10}
                  onChange={(e) => setButton(b.key, { text: e.target.value })}
                />
              </Field>
              {b.kind === 'url' ? (
                <Field label={t('buttonUrl')} htmlFor={`${base}-${b.key}-u`}>
                  <Input
                    id={`${base}-${b.key}-u`}
                    dir="ltr"
                    value={b.url}
                    placeholder="https://"
                    onChange={(e) => setButton(b.key, { url: e.target.value })}
                  />
                </Field>
              ) : b.kind === 'phone' ? (
                <Field label={t('buttonPhone')} htmlFor={`${base}-${b.key}-p`}>
                  <Input
                    id={`${base}-${b.key}-p`}
                    dir="ltr"
                    value={b.phone}
                    placeholder="+91"
                    onChange={(e) => setButton(b.key, { phone: e.target.value })}
                  />
                </Field>
              ) : (
                <span />
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label={tb('remove', { n: card.buttons.indexOf(b) + 1 })}
                onClick={() => onPatch({ buttons: card.buttons.filter((x) => x.key !== b.key) })}
              >
                <TrashIcon className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </li>
  );
}
