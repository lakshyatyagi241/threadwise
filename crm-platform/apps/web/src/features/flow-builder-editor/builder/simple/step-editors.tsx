'use client';

import { ButtonIcon } from '../button-icon';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  FLB_CAROUSEL_LIMITS,
  FLB_CAROUSEL_MAX_BUTTONS,
  FLB_CAROUSEL_MAX_CARDS,
  FLB_ASK_FILE_GROUPS,
  FLB_ASK_INPUT_TYPES,
  FLB_DATE_FORMATS,
  flbCleanAskFileExtensions,
  flbCleanAskInputType,
  flbCleanDateFormat,
  type FlbBuilderContext,
} from '@crm/contracts';
import {
  askFileGroupLabel,
  askInputLabel,
  askInputWrongText,
  dateFormatLabel,
} from '../../lib/contract-text';
import { renderMsg, useFlb } from '../../lib/msg';
import { conditionTreeOf } from '../../lib/condition-tree';
import { ConditionGroupEditor } from '../inspector/forms-core/logic';
import { usePickerFeed } from '@/features/contacts-attributes-tags';
import { Field, Input, Select, Textarea } from '@crm/ui';
import {
  BRANCHING,
  LIMITS,
  stageIn,
  groupsOf,
  groupText,
  stepLabel,
  stepSummary,
  type SimpleDoc,
  type SimpleStep,
} from '../../lib/simple-model';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Where a button or row leads: nothing (the conversation ends), or any step of any journey, or a brand new journey. */
export const NEW_JOURNEY = '__new__';

export function LinkSelect({
  doc,
  stepId,
  value,
  onChange,
}: {
  doc: SimpleDoc;
  /** The step the button is on: a button can lead back to its own step. */
  stepId: string;
  value: string | null;
  onChange: (target: string | null | typeof NEW_JOURNEY) => void;
}) {
  const t = useTranslations('flb.builder.simple.editors');
  const tf = useFlb();
  return (
    <Select
      aria-label={t('linkLabel')}
      className="h-9 text-[12.5px]"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    >
      <option value="">{t('linkEnds')}</option>
      {groupsOf(doc).map((g) => (
        <optgroup key={g.key} label={groupText(g, tf)}>
          {g.chains.flatMap((ci) =>
            doc.journeys[ci]!.steps.map((s, si) => (
              <option key={s.id} value={s.id}>
                {t('linkOption', {
                  stage: stageIn(doc, ci, si),
                  label: renderMsg(tf, stepLabel(s)),
                  self: s.id === stepId ? 'true' : 'false',
                  hasSummary: stepSummary(s, tf) ? 'true' : 'false',
                  summary: stepSummary(s, tf),
                })}
              </option>
            )),
          )}
        </optgroup>
      ))}
      <option value={NEW_JOURNEY}>{t('linkNew')}</option>
    </Select>
  );
}

interface EditorProps {
  step: SimpleStep;
  doc: SimpleDoc;
  ctx: FlbBuilderContext;
  /** Merge keys into the step's data. */
  set: (patch: Record<string, unknown>) => void;
  /** Point button / row `i` at a step (or `null` to end, or NEW_JOURNEY). */
  link: (i: number, target: string | null) => void;
}

const Counter = ({ value, max }: { value: string; max: number }) => (
  <span
    className={`font-mono text-[10.5px] ${value.length > max ? 'text-danger' : 'text-muted-foreground'}`}
  >
    {value.length}/{max}
  </span>
);

const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+/, '')
    .slice(0, 40);

const Row = ({ children }: { children: ReactNode }) => (
  <div className="rounded-xl border border-border bg-muted/40 p-2.5">{children}</div>
);

export function StepEditor(p: EditorProps) {
  const { step: s } = p;
  switch (s.type) {
    case 'message':
      return <MessageEditor {...p} />;
    case 'media':
      return <MediaEditor {...p} />;
    case 'buttons':
      return <ButtonsEditor {...p} />;
    case 'carousel':
      return <CarouselEditor {...p} />;
    case 'condition':
      return <ConditionEditor {...p} />;
    case 'list':
      return <ListEditor {...p} />;
    case 'ask':
      return <AskEditor {...p} />;
    case 'ask_file':
      return <AskFileEditor {...p} />;
    case 'ask_location':
      return <AskLocationEditor {...p} />;
    case 'delay':
      return <DelayEditor {...p} />;
    case 'location':
      return <LocationEditor {...p} />;
    case 'template':
      return <TemplateEditor {...p} />;
    case 'cta':
      return <CtaEditor {...p} />;
    case 'assign':
      return <AssignEditor {...p} />;
  }
}

function MessageEditor({ step, set }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  return (
    <Field label={t('message.label')} hint={t('message.hint', { token: '{{name}}' })}>
      <Textarea
        rows={5}
        value={str(step.data.text)}
        onChange={(e) => set({ text: e.target.value })}
      />
    </Field>
  );
}

const MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;

function MediaEditor({ step, set }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const kind = str(step.data.kind) || 'image';
  return (
    <div className="space-y-3">
      <Field label={t('media.type')}>
        <Select value={kind} onChange={(e) => set({ kind: e.target.value })}>
          {MEDIA_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`media.kinds.${k}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('media.fileLink')} hint={t('media.fileLinkHint')}>
        <Input
          value={str(step.data.url)}
          placeholder="https://"
          onChange={(e) => set({ url: e.target.value })}
        />
      </Field>
      {kind === 'document' ? (
        <Field label={t('media.fileName')}>
          <Input
            value={str(step.data.filename)}
            onChange={(e) => set({ filename: e.target.value })}
          />
        </Field>
      ) : null}
      {kind !== 'audio' ? (
        <Field label={t('media.caption')}>
          <Textarea
            rows={3}
            value={str(step.data.caption)}
            onChange={(e) => set({ caption: e.target.value })}
          />
        </Field>
      ) : null}
    </div>
  );
}

/**
 * The Condition step: rules joined by AND / OR (groups can nest), then two exits, one when they hold and one when they do not. The
 * rules are the same editor the Advanced builder's Condition node has.
 */
function ConditionEditor({ step, doc, set, link }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const tree = conditionTreeOf(step.data)?.tree ?? {
    op: 'and' as const,
    items: [{ variable: '', operator: 'equals', value: '' }],
  };
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">{t('condition.info')}</p>
      <ConditionGroupEditor tree={tree} onChange={(next) => set({ conditionGroup: next })} />
      {(['yes', 'no'] as const).map((exit, i) => (
        <Row key={exit}>
          <div className="mb-1.5 text-[12px] font-semibold">{t(`condition.${exit}`)}</div>
          <LinkSelect
            doc={doc}
            stepId={step.id}
            value={step.links[i] ?? null}
            onChange={(target) => link(i, target)}
          />
        </Row>
      ))}
    </div>
  );
}

const CAROUSEL_BTN_KINDS = ['reply', 'agent', 'url', 'phone', 'email'] as const;

/** The team and the note of a button that hands the visitor to a person: nothing needs to be connected after such a button. */
function HandoffFields({
  ctx,
  team,
  note,
  onTeam,
  onNote,
}: {
  ctx: FlbBuilderContext;
  team: string;
  note: string;
  onTeam: (v: string) => void;
  onNote: (v: string) => void;
}) {
  const t = useTranslations('flb.builder.simple.editors');
  return (
    <div className="mt-2 space-y-2">
      <Select value={team} onChange={(e) => onTeam(e.target.value)}>
        <option value="">{ctx.teams.length ? t('assign.pickTeam') : t('assign.noTeams')}</option>
        {ctx.teams.map((tm) => (
          <option key={tm.id} value={tm.id}>
            {t('assign.teamOption', { name: tm.name, count: tm.members.length })}
          </option>
        ))}
      </Select>
      <Input value={note} placeholder={t('assign.note')} onChange={(e) => onNote(e.target.value)} />
      <p className="text-[11.5px] text-muted-foreground">{t('handoff.hint')}</p>
    </div>
  );
}

/**
 * The Carousel step: cards (a picture link, a title, a line of text) with up to two buttons each. A "reply in chat" button is an exit
 * of the step (pick where it leads, like a Quick reply); the others open a page, a call or an email.
 */
function CarouselEditor({ step, doc, ctx, set, link }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const cards = arr(step.data.cards).map(rec);
  const setCards = (next: Array<Record<string, unknown>>) => set({ cards: next });
  const patchCard = (i: number, p: Record<string, unknown>) =>
    setCards(cards.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const buttonsOf = (c: Record<string, unknown>) => arr(c.buttons).map(rec);
  const patchBtn = (i: number, k: number, p: Record<string, unknown>) =>
    patchCard(i, { buttons: buttonsOf(cards[i]!).map((b, j) => (j === k ? { ...b, ...p } : b)) });
  const isReply = (b: Record<string, unknown>) =>
    str(b.type) === 'reply' || str(b.type) === 'agent';
  // The position of a reply button among all the step's replies is its exit.
  const replyIndex = (ci: number, bi: number): number =>
    cards.slice(0, ci).reduce((n, c) => n + buttonsOf(c).filter(isReply).length, 0) +
    buttonsOf(cards[ci]!).slice(0, bi).filter(isReply).length;
  const holder = (kind: string) =>
    kind === 'phone' ? '+91 98765 43210' : kind === 'email' ? 'name@example.com' : 'https://';
  return (
    <div className="space-y-3">
      <Field label={t('carousel.intro')}>
        <Textarea
          rows={2}
          value={str(step.data.text)}
          onChange={(e) => set({ text: e.target.value })}
        />
      </Field>
      {cards.map((c, ci) => (
        <Row key={ci}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold">{t('carousel.card', { n: ci + 1 })}</span>
            <RemoveBtn
              label={t('carousel.removeCard')}
              disabled={cards.length <= 1}
              onClick={() => setCards(cards.filter((_, j) => j !== ci))}
            />
          </div>
          <div className="space-y-2">
            <Field label={t('carousel.image')}>
              <Input
                value={str(c.image)}
                placeholder="https://"
                onChange={(e) => patchCard(ci, { image: e.target.value })}
              />
            </Field>
            <Field
              label={
                <span className="flex items-center justify-between">
                  {t('carousel.title')}{' '}
                  <Counter value={str(c.title)} max={FLB_CAROUSEL_LIMITS.title} />
                </span>
              }
            >
              <Input
                value={str(c.title)}
                maxLength={FLB_CAROUSEL_LIMITS.title + 20}
                onChange={(e) => patchCard(ci, { title: e.target.value })}
              />
            </Field>
            <Field
              label={
                <span className="flex items-center justify-between">
                  {t('carousel.text')}{' '}
                  <Counter value={str(c.text)} max={FLB_CAROUSEL_LIMITS.text} />
                </span>
              }
            >
              <Textarea
                rows={2}
                value={str(c.text)}
                onChange={(e) => patchCard(ci, { text: e.target.value })}
              />
            </Field>
            <div className="text-[12px] font-medium">{t('carousel.buttons')}</div>
            {buttonsOf(c).map((b, bi) => {
              const kind = (CAROUSEL_BTN_KINDS as readonly string[]).includes(str(b.type))
                ? str(b.type)
                : 'reply';
              const ri = replyIndex(ci, bi);
              return (
                <div key={bi} className="rounded-lg border border-border bg-background p-2">
                  <div className="grid gap-2 sm:grid-cols-[9rem_1fr_1fr_auto]">
                    <Select
                      value={kind}
                      onChange={(e) => patchBtn(ci, bi, { type: e.target.value })}
                    >
                      {CAROUSEL_BTN_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`carousel.btnKinds.${k}`)}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={str(b.label)}
                      maxLength={FLB_CAROUSEL_LIMITS.label + 10}
                      placeholder={t('carousel.label')}
                      onChange={(e) => patchBtn(ci, bi, { label: e.target.value })}
                    />
                    {kind === 'reply' || kind === 'agent' ? (
                      <span />
                    ) : (
                      <Input
                        value={str(b.value)}
                        placeholder={holder(kind)}
                        onChange={(e) => patchBtn(ci, bi, { value: e.target.value })}
                      />
                    )}
                    <RemoveBtn
                      label={t('carousel.removeButton')}
                      onClick={() =>
                        patchCard(ci, { buttons: buttonsOf(c).filter((_, j) => j !== bi) })
                      }
                    />
                  </div>
                  {kind === 'reply' ? (
                    <div className="mt-2">
                      <LinkSelect
                        doc={doc}
                        stepId={step.id}
                        value={step.links[ri] ?? null}
                        onChange={(target) => link(ri, target)}
                      />
                    </div>
                  ) : kind === 'agent' ? (
                    <HandoffFields
                      ctx={ctx}
                      team={str(b.team)}
                      note={str(b.note)}
                      onTeam={(v) => patchBtn(ci, bi, { team: v })}
                      onNote={(v) => patchBtn(ci, bi, { note: v })}
                    />
                  ) : null}
                </div>
              );
            })}
            {buttonsOf(c).length < FLB_CAROUSEL_MAX_BUTTONS ? (
              <AddBtn
                onClick={() =>
                  patchCard(ci, {
                    buttons: [...buttonsOf(c), { type: 'reply', label: '', value: '' }],
                  })
                }
              >
                {t('carousel.addButton')}
              </AddBtn>
            ) : null}
          </div>
        </Row>
      ))}
      {cards.length < FLB_CAROUSEL_MAX_CARDS ? (
        <AddBtn
          onClick={() =>
            setCards([
              ...cards,
              { image: '', title: '', text: '', buttons: [{ type: 'url', label: '', value: '' }] },
            ])
          }
        >
          {t('carousel.addCard')}
        </AddBtn>
      ) : null}
    </div>
  );
}

function ButtonsEditor({ step, doc, ctx, set, link }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const opts = arr(step.data.options).map(str);
  // The small picture of each button (website chat bots only), by position.
  const icons = opts.map((_, j) => str(arr(step.data.optionIcons)[j]));
  const prompt = str(step.data.prompt);
  // A button can hand the visitor to a person instead of leading to another step: `handoffs` is keyed by the button's position.
  const handoffs = rec(step.data.handoffs);
  const setHandoff = (i: number, h: { team: string; message: string } | null) => {
    const next = { ...handoffs };
    if (h) next[String(i)] = h;
    else delete next[String(i)];
    set({ handoffs: next });
  };
  const withoutOption = (i: number) =>
    Object.fromEntries(
      Object.entries(handoffs)
        .filter(([k]) => Number(k) !== i)
        .map(([k, v]) => [String(Number(k) > i ? Number(k) - 1 : Number(k)), v]),
    );
  return (
    <div className="space-y-3">
      <Field
        label={
          <span className="flex items-center justify-between">
            {t('buttons.above')} <Counter value={prompt} max={LIMITS.body} />
          </span>
        }
      >
        <Textarea rows={4} value={prompt} onChange={(e) => set({ prompt: e.target.value })} />
      </Field>
      <div className="space-y-2">
        <div className="text-[12px] font-medium">
          {t.rich('buttons.heading', {
            max: LIMITS.buttons,
            muted: (chunks) => <span className="font-normal text-muted-foreground">{chunks}</span>,
          })}
        </div>
        {opts.map((o, i) => (
          <Row key={i}>
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={o}
                maxLength={LIMITS.buttonLabel + 20}
                placeholder={t('buttons.placeholder', { n: i + 1 })}
                invalid={o.length > LIMITS.buttonLabel}
                onChange={(e) =>
                  set({ options: opts.map((x, j) => (j === i ? e.target.value : x)) })
                }
              />
              <Counter value={o} max={LIMITS.buttonLabel} />
              <RemoveBtn
                label={t('buttons.remove')}
                disabled={opts.length <= 1}
                onClick={() =>
                  set({
                    options: opts.filter((_, j) => j !== i),
                    optionIcons: icons.filter((_, j) => j !== i),
                    handoffs: withoutOption(i),
                  })
                }
              />
            </div>
            <div className="mb-2">
              <ButtonIcon
                value={icons[i] ?? ''}
                onChange={(v) => set({ optionIcons: icons.map((x, j) => (j === i ? v : x)) })}
              />
            </div>
            <label className="mb-2 flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={handoffs[String(i)] !== undefined}
                onChange={(e) => {
                  if (e.target.checked) {
                    link(i, null);
                    setHandoff(i, { team: '', message: '' });
                  } else setHandoff(i, null);
                }}
              />
              {t('buttons.handoff')}
            </label>
            {handoffs[String(i)] !== undefined ? (
              <HandoffFields
                ctx={ctx}
                team={str(rec(handoffs[String(i)]).team)}
                note={str(rec(handoffs[String(i)]).message)}
                onTeam={(v) =>
                  setHandoff(i, { team: v, message: str(rec(handoffs[String(i)]).message) })
                }
                onNote={(v) =>
                  setHandoff(i, { team: str(rec(handoffs[String(i)]).team), message: v })
                }
              />
            ) : (
              <LinkSelect
                doc={doc}
                stepId={step.id}
                value={step.links[i] ?? null}
                onChange={(target) => link(i, target)}
              />
            )}
          </Row>
        ))}
        {opts.length < LIMITS.buttons ? (
          <AddBtn
            onClick={() =>
              set({ options: [...opts, t('buttons.placeholder', { n: opts.length + 1 })] })
            }
          >
            {t('buttons.add')}
          </AddBtn>
        ) : null}
      </div>
      <VarField step={step} set={set} label={t('buttons.saveIn')} />
      <SavePropertyField step={step} set={set} noun="button" />
    </div>
  );
}

function ListEditor({ step, doc, set, link }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const rows = arr(step.data.options).map(rec);
  const prompt = str(step.data.prompt);
  const button = str(step.data.button);
  const setRow = (i: number, patch: Record<string, unknown>) =>
    set({ options: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-3">
      <Field
        label={
          <span className="flex items-center justify-between">
            {t('list.above')} <Counter value={prompt} max={LIMITS.body} />
          </span>
        }
      >
        <Textarea rows={4} value={prompt} onChange={(e) => set({ prompt: e.target.value })} />
      </Field>
      <Field
        label={
          <span className="flex items-center justify-between">
            {t('list.buttonText')} <Counter value={button} max={LIMITS.listButton} />
          </span>
        }
      >
        <Input
          value={button}
          invalid={button.length > LIMITS.listButton}
          onChange={(e) => set({ button: e.target.value })}
        />
      </Field>
      <div className="space-y-2">
        <div className="text-[12px] font-medium">
          {t.rich('list.heading', {
            max: LIMITS.rows,
            muted: (chunks) => <span className="font-normal text-muted-foreground">{chunks}</span>,
          })}
        </div>
        {rows.map((r, i) => (
          <Row key={i}>
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={str(r.title)}
                placeholder={t('list.rowPlaceholder', { n: i + 1 })}
                invalid={str(r.title).length > LIMITS.rowTitle}
                onChange={(e) => setRow(i, { title: e.target.value })}
              />
              <Counter value={str(r.title)} max={LIMITS.rowTitle} />
              <RemoveBtn
                label={t('list.remove')}
                disabled={rows.length <= 1}
                onClick={() => set({ options: rows.filter((_, j) => j !== i) })}
              />
            </div>
            <Input
              className="mb-2 h-9 text-[12.5px]"
              value={str(r.description)}
              placeholder={t('list.description')}
              invalid={str(r.description).length > LIMITS.rowDescription}
              onChange={(e) => setRow(i, { description: e.target.value })}
            />
            <LinkSelect
              doc={doc}
              stepId={step.id}
              value={step.links[i] ?? null}
              onChange={(target) => link(i, target)}
            />
          </Row>
        ))}
        {rows.length < LIMITS.rows ? (
          <AddBtn
            onClick={() =>
              set({
                options: [
                  ...rows,
                  {
                    title: t('list.rowPlaceholder', { n: rows.length + 1 }),
                    description: '',
                    section: '',
                  },
                ],
              })
            }
          >
            {t('list.add')}
          </AddBtn>
        ) : null}
      </div>
      <VarField step={step} set={set} label={t('list.saveIn')} />
      <SavePropertyField step={step} set={set} noun="row" />
    </div>
  );
}

/** What happens when an answer does not pass: the text sent, how many wrong answers are tolerated, and what then. */
function WrongAnswerFields({
  step,
  set,
  placeholder,
  defaultRetries,
}: {
  step: SimpleStep;
  set: (patch: Record<string, unknown>) => void;
  placeholder: string;
  defaultRetries: string;
}) {
  const t = useTranslations('flb.builder.simple.editors.wrong');
  const retries = Number(step.data.retries) || 0;
  return (
    <div className="space-y-3">
      <Field label={t('message')} hint={t('messageHint')}>
        <Textarea
          rows={2}
          value={str(step.data.wrongReply)}
          placeholder={placeholder}
          onChange={(e) => set({ wrongReply: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('stopAfter')} hint={defaultRetries}>
          <Input
            type="number"
            min={0}
            max={10}
            value={str(step.data.retries)}
            onChange={(e) =>
              set({ retries: Math.min(10, Math.max(0, Math.trunc(Number(e.target.value) || 0))) })
            }
          />
        </Field>
        {retries > 0 ? (
          <Field label={t('then')}>
            <Select
              value={str(step.data.onFail) === 'end' ? 'end' : 'continue'}
              onChange={(e) => set({ onFail: e.target.value })}
            >
              <option value="continue">{t('continue')}</option>
              <option value="end">{t('end')}</option>
            </Select>
          </Field>
        ) : null}
      </div>
    </div>
  );
}

/** "Also copy the answer to a contact property". */
function SavePropertyField({
  step,
  set,
  noun = 'answer',
}: {
  step: SimpleStep;
  set: (patch: Record<string, unknown>) => void;
  noun?: 'answer' | 'button' | 'row';
}) {
  const t = useTranslations('flb.builder.simple.editors.property');
  const feed = usePickerFeed();
  const on = step.data.saveProperty === true;
  return (
    <Field label={t('label')}>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => set({ saveProperty: e.target.checked })}
        />
        {t('copy', { what: noun })}
      </label>
      {on ? (
        <Select
          aria-label={t('label')}
          className="mt-2"
          value={str(step.data.propertyKey)}
          onChange={(e) => set({ propertyKey: e.target.value })}
        >
          <option value="">{t('choose')}</option>
          {(feed.data?.custom ?? []).map((pr) => (
            <option key={pr.key} value={pr.key}>
              {pr.name}
            </option>
          ))}
        </Select>
      ) : null}
    </Field>
  );
}

function AskEditor({ step, set }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const tf = useFlb();
  const type = flbCleanAskInputType(step.data.validate);
  const checked = type !== 'text';
  return (
    <div className="space-y-3">
      <Field label={t('question')}>
        <Textarea
          rows={3}
          value={str(step.data.prompt)}
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </Field>
      <Field label={t('ask.accept')} hint={checked ? t('ask.checkedHint') : t('ask.anyTextHint')}>
        <Select value={type} onChange={(e) => set({ validate: e.target.value })}>
          {FLB_ASK_INPUT_TYPES.map((v) => (
            <option key={v} value={v}>
              {askInputLabel(tf, v)}
            </option>
          ))}
        </Select>
      </Field>
      {type === 'date' ? (
        <Field label={t('ask.dateFormat')} hint={t('ask.dateFormatHint')}>
          <Select
            value={flbCleanDateFormat(step.data.dateFormat)}
            onChange={(e) => set({ dateFormat: e.target.value })}
          >
            {FLB_DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {dateFormatLabel(tf, f)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {type === 'phone' ? (
        <label className="flex items-start gap-2 text-[12.5px]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={step.data.verifyOtp === true}
            onChange={(e) => set({ verifyOtp: e.target.checked })}
          />
          <span>
            <span className="font-medium">{t('ask.verifyOtp')}</span>
            <span className="mt-0.5 block text-muted-foreground">{t('ask.verifyOtpHint')}</span>
          </span>
        </label>
      ) : null}
      <VarField step={step} set={set} label={t('ask.saveIn')} />
      {checked ? (
        <>
          <WrongAnswerFields
            step={step}
            set={set}
            placeholder={askInputWrongText(tf, type, step.data.dateFormat)}
            defaultRetries={t('ask.retriesHint')}
          />
        </>
      ) : null}
      <SavePropertyField step={step} set={set} />
    </div>
  );
}

function AskFileEditor({ step, set }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const tf = useFlb();
  const chosen = new Set(flbCleanAskFileExtensions(step.data.extensions));
  const toggle = (exts: readonly string[], on: boolean) => {
    const next = new Set(chosen);
    for (const e of exts) {
      if (on) next.add(e);
      else next.delete(e);
    }
    set({ extensions: flbCleanAskFileExtensions([...next]) });
  };
  return (
    <div className="space-y-3">
      <Field label={t('question')}>
        <Textarea
          rows={3}
          value={str(step.data.prompt)}
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </Field>
      <Field
        label={t('askFile.accepted')}
        hint={
          chosen.size === 0
            ? t('askFile.noneTicked')
            : t('askFile.only', { list: [...chosen].join(', ') })
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {FLB_ASK_FILE_GROUPS.map((g) => {
            const exts = g.extensions.map((e) => e.ext);
            return (
              <label key={g.id} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={exts.every((e) => chosen.has(e))}
                  onChange={(e) => toggle(exts, e.target.checked)}
                />
                {askFileGroupLabel(tf, g.id, g.label)}
              </label>
            );
          })}
        </div>
      </Field>
      <VarField step={step} set={set} label={t('askFile.saveIn')} />
      <WrongAnswerFields
        step={step}
        set={set}
        placeholder={t('askFile.wrongText')}
        defaultRetries={t('retriesHint')}
      />
      <SavePropertyField step={step} set={set} />
    </div>
  );
}

function AskLocationEditor({ step, set }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  return (
    <div className="space-y-3">
      <Field label={t('question')}>
        <Textarea
          rows={3}
          value={str(step.data.prompt)}
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </Field>
      <VarField step={step} set={set} label={t('askLocation.saveIn')} />
      <WrongAnswerFields
        step={step}
        set={set}
        placeholder={t('askLocation.wrongText')}
        defaultRetries={t('retriesHint')}
      />
    </div>
  );
}

function VarField({
  step,
  set,
  label,
}: {
  step: SimpleStep;
  set: (patch: Record<string, unknown>) => void;
  label: string;
}) {
  const t = useTranslations('flb.builder.simple.editors.var');
  return (
    <Field
      label={label}
      hint={t.rich('hint', {
        code: () => <code className="font-mono">{`{{${str(step.data.var) || 'name'}}}`}</code>,
      })}
    >
      <Input
        className="font-mono"
        value={str(step.data.var)}
        onChange={(e) => set({ var: slug(e.target.value) })}
      />
    </Field>
  );
}

function AssignEditor({ step, ctx, set }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const teams = ctx.teams;
  const team = teams.find((x) => x.id === str(step.data.team));
  return (
    <div className="space-y-3">
      <Field label={t('assign.team')} hint={t('assign.teamHint')}>
        <Select
          value={str(step.data.team)}
          onChange={(e) => set({ team: e.target.value, userId: '' })}
        >
          <option value="">{teams.length ? t('assign.pickTeam') : t('assign.noTeams')}</option>
          {teams.map((tm) => (
            <option key={tm.id} value={tm.id}>
              {t('assign.teamOption', { name: tm.name, count: tm.members.length })}
            </option>
          ))}
          {str(step.data.team) && !team ? (
            <option value={str(step.data.team)}>
              {t('assign.unknownTeam', { team: str(step.data.team) })}
            </option>
          ) : null}
        </Select>
      </Field>
      {team ? (
        <Field label={t('assign.agent')} hint={t('assign.agentHint')}>
          <Select value={str(step.data.userId)} onChange={(e) => set({ userId: e.target.value })}>
            <option value="">{t('assign.any')}</option>
            {team.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={t('assign.note')} hint={t('assign.noteHint')}>
        <Textarea
          rows={3}
          value={str(step.data.message)}
          onChange={(e) => set({ message: e.target.value })}
        />
      </Field>
    </div>
  );
}

function DelayEditor({ step, set }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('delay.waitFor')}>
        <Input
          type="number"
          min={1}
          value={str(step.data.amount)}
          onChange={(e) => set({ amount: e.target.value === '' ? '' : Number(e.target.value) })}
        />
      </Field>
      <Field label={t('delay.unit')}>
        <Select
          value={str(step.data.unit) || 'min'}
          onChange={(e) => set({ unit: e.target.value })}
        >
          <option value="sec">{t('delay.sec')}</option>
          <option value="min">{t('delay.min')}</option>
          <option value="hour">{t('delay.hour')}</option>
          <option value="day">{t('delay.day')}</option>
        </Select>
      </Field>
    </div>
  );
}

function LocationEditor({ step, set }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const f = (key: string, label: string, props: { placeholder?: string } = {}) => (
    <Field label={label}>
      <Input
        value={str(step.data[key])}
        placeholder={props.placeholder}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <div className="space-y-3">
      {f('title', t('location.placeName'), { placeholder: t('location.placePlaceholder') })}
      {f('address', t('location.address'))}
      <div className="grid grid-cols-2 gap-3">
        {f('lat', t('location.latitude'), { placeholder: '18.5204' })}
        {f('lng', t('location.longitude'), { placeholder: '73.8567' })}
      </div>
    </div>
  );
}

function TemplateEditor({ step, ctx, set }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const chosen = ctx.templates.find((x) => x.name === str(step.data.tpl));
  return (
    <div className="space-y-3">
      <Field label={t('template.label')} hint={t('template.hint')}>
        <Select
          value={str(step.data.tpl)}
          onChange={(e) => {
            const hit = ctx.templates.find((x) => x.name === e.target.value);
            set({ tpl: e.target.value, tplId: hit ? hit.id : null });
          }}
        >
          <option value="">{t('template.choose')}</option>
          {ctx.templates.map((tp) => (
            <option key={tp.id} value={tp.name}>
              {tp.name}
            </option>
          ))}
        </Select>
      </Field>
      {chosen?.body ? (
        <div className="whitespace-pre-wrap rounded-xl bg-[var(--flb-bubble)] p-3 text-[12.5px]">
          {chosen.body}
        </div>
      ) : null}
    </div>
  );
}

const CTA_KINDS = ['url', 'phone', 'email'] as const;
const CTA_MAX = 3;

/**
 * The buttons of a Link button step: up to three, each opening a web page, a phone call or an email. The website chat window draws
 * all of them; WhatsApp sends the first web link as its button and the rest as lines of text.
 */
function CtaEditor({ step, set }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const raw = arr(step.data.actions).map(rec);
  const actions = raw.length ? raw : [{ type: 'url', label: '', value: '' }];
  const setAll = (next: Array<Record<string, unknown>>) => set({ actions: next });
  const patch = (i: number, p: Record<string, unknown>) =>
    setAll(
      actions.map((a, j) => (j === i ? { type: 'url', label: '', value: '', ...a, ...p } : a)),
    );
  const holder = (kind: string) =>
    kind === 'phone' ? '+91 98765 43210' : kind === 'email' ? 'name@example.com' : 'https://';
  return (
    <div className="space-y-3">
      <Field label={t('message.label')}>
        <Textarea
          rows={3}
          value={str(step.data.bodyText)}
          onChange={(e) => set({ bodyText: e.target.value })}
        />
      </Field>
      {actions.map((a, i) => {
        const kind = (CTA_KINDS as readonly string[]).includes(str(a.type)) ? str(a.type) : 'url';
        return (
          <Row key={i}>
            <div className="grid gap-3 sm:grid-cols-[9rem_1fr_1fr_auto]">
              <Field label={t('cta.type')}>
                <Select value={kind} onChange={(e) => patch(i, { type: e.target.value })}>
                  {CTA_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`cta.kinds.${k}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('cta.buttonText')}>
                <Input
                  value={str(a.label)}
                  maxLength={20}
                  onChange={(e) => patch(i, { label: e.target.value })}
                />
              </Field>
              <Field
                label={t(
                  kind === 'phone'
                    ? 'cta.opensPhone'
                    : kind === 'email'
                      ? 'cta.opensEmail'
                      : 'cta.opens',
                )}
              >
                <Input
                  value={str(a.value)}
                  placeholder={holder(kind)}
                  onChange={(e) => patch(i, { value: e.target.value })}
                />
              </Field>
              <div className="flex items-end pb-1">
                <RemoveBtn
                  label={t('cta.remove')}
                  disabled={actions.length <= 1}
                  onClick={() => setAll(actions.filter((_, j) => j !== i))}
                />
              </div>
            </div>
            <div className="mt-2">
              <ButtonIcon value={str(a.icon)} onChange={(v) => patch(i, { icon: v })} />
            </div>
          </Row>
        );
      })}
      {actions.length < CTA_MAX ? (
        <AddBtn onClick={() => setAll([...actions, { type: 'url', label: '', value: '' }])}>
          {t('cta.add')}
        </AddBtn>
      ) : null}
    </div>
  );
}

function AddBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-[12px] font-medium text-brand hover:bg-muted"
    >
      <span aria-hidden>+</span> {children}
    </button>
  );
}

function RemoveBtn({
  onClick,
  label,
  disabled,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-danger disabled:opacity-30"
    >
      ✕
    </button>
  );
}

export { BRANCHING };
