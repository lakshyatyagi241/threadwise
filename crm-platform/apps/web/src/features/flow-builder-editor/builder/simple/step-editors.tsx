'use client';

import { ButtonIcon } from '../button-icon';
import { MessageField } from '../message-field';
import { ctaLinkProblem } from '../../lib/cta-link';
import { flowVariables } from '../../lib/flow-variables';
import { ButtonActionPicker } from '../button-action-picker';
import {
  buttonActionContinues,
  buttonActionOf,
  buttonActionPatch,
  buttonActionsWithout,
} from '../../lib/button-actions';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  FLB_AGE_END_TEXT,
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
import {
  FAQ_DEFAULT_QUERY,
  FAQ_MIN_SCORE,
  FAQ_MIN_SCORE_START,
  FAQ_VARIABLES,
  faqSaveName,
  hasOwnMinScore,
  minScoreOutOfRange,
} from '../../lib/faq-node';
import { useFaqSummary } from '../../api/hooks';
import { faqHref } from '@/features/faq-knowledge/lib/links';
import { renderMsg, useFlb } from '../../lib/msg';
import { conditionTreeOf } from '../../lib/condition-tree';
import { AiForm, CodeForm, ConditionGroupEditor, WebhookForm } from '../inspector/forms-core/logic';
import { usePickerFeed } from '@/features/contacts-attributes-tags';
import { Field, Input, Select, Textarea, useToast } from '@crm/ui';
import { NewPropertyInline } from '../new-property';
import { ApiLibraryForm } from '../inspector/forms-channels/api-library';
import { TemplatePreview } from '../inspector/forms-core/previews';
import type { FormComponent, FormEnv } from '../inspector/types';
import { MediaUpload } from './media-upload';
import {
  BRANCHING,
  LINK_END,
  LINK_NEXT,
  OPTION_STEPS,
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
  decide = false,
  onChange,
}: {
  doc: SimpleDoc;
  /** The step the button is on: a button can lead back to its own step. */
  stepId: string;
  value: string | null;
  /** A button or row the customer sees: it has to lead somewhere, so "ends here" is a choice and "not chosen yet" is shown as such. */
  decide?: boolean;
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
      {decide ? (
        <>
          <option value="" disabled>
            {t('linkChoose')}
          </option>
          <option value={LINK_END}>{t('linkEnds')}</option>
        </>
      ) : (
        <option value="">{t('linkEnds')}</option>
      )}
      {/* A buttons / list step with a step after it can carry on with that step. */}
      {(() => {
        const own = doc.journeys.find((j) => j.steps.some((x) => x.id === stepId));
        const at = own?.steps.findIndex((x) => x.id === stepId) ?? -1;
        return own && OPTION_STEPS.has(own.steps[at]!.type) && own.steps[at + 1] ? (
          <option value={LINK_NEXT}>{t('linkNext')}</option>
        ) : null;
      })()}
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
  /** The saved flow (null before the first save): the FAQ step answers from this flow's FAQs. */
  flowId: string | null;
  /** Merge keys into the step's data; `links` (one per button / row) replaces the step's links in the same change. */
  set: (patch: Record<string, unknown>, links?: (string | null)[]) => void;
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
    case 'api_library':
      return <NodeFormEditor {...p} Form={ApiLibraryForm} />;
    case 'webhook':
      return <NodeFormEditor {...p} Form={WebhookForm} />;
    case 'code':
      return <NodeFormEditor {...p} Form={CodeForm} />;
    case 'ai':
      return <NodeFormEditor {...p} Form={AiForm} />;
    case 'faq':
      return <FaqEditor {...p} />;
  }
}

/**
 * A step whose settings are the Advanced builder's own form for the same node (API call, JS function): the form is given the step's data
 * as a node, so the two builders edit one thing in one way.
 */
function NodeFormEditor({ step, ctx, flowId, set, Form }: EditorProps & { Form: FormComponent }) {
  const { toast } = useToast();
  const env: FormEnv = {
    ctx,
    loading: false,
    mode: 'chat',
    openedAs: 'chat',
    channels: ['chat'],
    refresh: () => undefined,
    toast,
    uploadMedia: () => Promise.reject(new Error('unsupported')),
    nodes: [],
    flowId,
  };
  return (
    <Form
      node={{ id: step.id, type: step.type, x: 0, y: 0, data: step.data }}
      data={step.data}
      set={(key, value) => set({ [key]: value })}
      setMany={set}
      env={env}
      addOption={() => undefined}
      removeOption={() => undefined}
    />
  );
}

function MessageEditor({ step, doc, set }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  return (
    <Field label={t('message.label')}>
      <MessageField
        rows={5}
        label={t('message.label')}
        value={str(step.data.text)}
        max={LIMITS.message}
        variables={flowVariables(doc)}
        onChange={(text) => set({ text })}
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
      <MediaUpload
        kind={kind as 'image'}
        url={str(step.data.url)}
        filename={str(step.data.filename)}
        onDone={(res) => set({ url: res.url, filename: res.filename })}
      />
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
              <div className="mb-2">
                <MediaUpload
                  compact
                  kind="image"
                  url={str(c.image)}
                  filename=""
                  onDone={(res) => patchCard(ci, { image: res.url })}
                />
              </div>
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
                        decide
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

function ButtonsEditor({ step, doc, ctx, flowId, set, link }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const opts = arr(step.data.options).map(str);
  // The small picture of each button (website chat bots only), by position.
  const icons = opts.map((_, j) => str(arr(step.data.optionIcons)[j]));
  const prompt = str(step.data.prompt);
  return (
    <div className="space-y-3">
      <Field label={t('buttons.above')}>
        <MessageField
          rows={4}
          label={t('buttons.above')}
          value={prompt}
          max={LIMITS.body}
          variables={flowVariables(doc)}
          onChange={(v) => set({ prompt: v })}
        />
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
                  set(
                    {
                      options: opts.filter((_, j) => j !== i),
                      optionIcons: icons.filter((_, j) => j !== i),
                      ...buttonActionsWithout(step.data, i),
                    },
                    step.links.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
            <div className="mb-2">
              <ButtonIcon
                value={icons[i] ?? ''}
                onChange={(v) => set({ optionIcons: icons.map((x, j) => (j === i ? v : x)) })}
              />
            </div>
            <div className="mb-2">
              <ButtonActionPicker
                value={buttonActionOf(step.data, i)}
                ctx={ctx}
                flowId={flowId}
                onChange={(next) =>
                  // A hand-over, or a connected flow, takes the conversation away: nothing is connected after such a button. The link
                  // goes in the same change as the action (two separate changes would overwrite each other).
                  set(
                    buttonActionPatch(step.data, i, next),
                    buttonActionContinues(next)
                      ? undefined
                      : step.links.map((l, j) => (j === i ? null : l)),
                  )
                }
              />
            </div>
            {buttonActionContinues(buttonActionOf(step.data, i)) ? (
              <LinkSelect
                doc={doc}
                stepId={step.id}
                value={step.links[i] ?? null}
                decide
                onChange={(target) => link(i, target)}
              />
            ) : null}
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
      <Field label={t('list.above')}>
        <MessageField
          rows={4}
          label={t('list.above')}
          value={prompt}
          max={LIMITS.body}
          variables={flowVariables(doc)}
          onChange={(v) => set({ prompt: v })}
        />
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
              decide
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
        <>
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
          <NewPropertyInline onCreated={(key) => set({ propertyKey: key })} />
        </>
      ) : null}
    </Field>
  );
}

function AskEditor({ step, doc, set }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const tf = useFlb();
  const ta = useTranslations('flb.builder.askAge');
  const type = flbCleanAskInputType(step.data.validate);
  const checked = type !== 'text';
  return (
    <div className="space-y-3">
      <Field label={t('question')}>
        <MessageField
          rows={3}
          label={t('question')}
          value={str(step.data.prompt)}
          max={LIMITS.body}
          variables={flowVariables(doc)}
          onChange={(v) => set({ prompt: v })}
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
      {type === 'date' || type === 'date_of_birth' ? (
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
      {type === 'age' || type === 'date_of_birth' ? (
        <>
          <Field label={ta('minAge')} hint={ta('minAgeHint')}>
            <Input
              type="number"
              min={1}
              max={21}
              value={step.data.ageMinAge === undefined ? '' : String(step.data.ageMinAge)}
              onChange={(e) => {
                const n = Math.trunc(Number(e.target.value));
                set({
                  ageMinAge:
                    e.target.value === '' || !Number.isFinite(n)
                      ? ''
                      : Math.min(21, Math.max(1, n)),
                });
              }}
            />
          </Field>
          <Field label={ta('whenUnder')} hint={ta('whenUnderHint')}>
            <Select
              value={step.data.ageWhenUnder === 'continue' ? 'continue' : 'end'}
              onChange={(e) => set({ ageWhenUnder: e.target.value })}
            >
              <option value="end">{ta('end')}</option>
              <option value="continue">{ta('continue')}</option>
            </Select>
          </Field>
          {step.data.ageWhenUnder === 'continue' ? (
            <p className="text-xs text-muted-foreground">{ta('continueNote')}</p>
          ) : (
            <Field label={ta('endText')} hint={ta('endTextHint')}>
              <Textarea
                rows={2}
                value={str(step.data.ageEndText)}
                placeholder={FLB_AGE_END_TEXT}
                onChange={(e) => set({ ageEndText: e.target.value })}
              />
            </Field>
          )}
          <p className="text-xs text-muted-foreground">{ta('note')}</p>
        </>
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

/**
 * "Answer from FAQ": the same settings as the Advanced form, and one "where it leads" for each of its two exits (an FAQ answered / no
 * FAQ answered). Like buttons and lists it ends its part of the flow: a flow FAQ continues in its own flow and does not come back.
 */
function FaqEditor({ step, doc, flowId, set, link }: EditorProps) {
  // The settings read the Advanced form's texts (one translation each); only the two "where it leads" lines are Simple's own.
  const t = useTranslations('flb.builder.formsChannels.faq');
  const ts = useTranslations('flb.builder.simple.editors.faq');
  const summary = useFaqSummary(flowId);
  const categories = summary.data?.categories ?? [];
  const category = str(step.data.category);
  const own = hasOwnMinScore(step.data.minScore);
  const outOfRange = minScoreOutOfRange(step.data.minScore);
  const send = step.data.sendAnswer !== false;
  const save = faqSaveName(step.data.save);
  const code = (c: ReactNode) => <code className="font-mono">{c}</code>;
  // Links into this flow's FAQs tab (a new tab, so the flow being edited stays open). Before the first save there is none.
  const page = (view: 'new' | 'test') =>
    function PageLink(c: ReactNode) {
      return flowId ? (
        <a
          href={faqHref(flowId, view)}
          target="_blank"
          rel="noreferrer"
          className="text-brand underline"
        >
          {c}
        </a>
      ) : (
        <>{c}</>
      );
    };
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">{t.rich('intro.body', { mono: code })}</p>
      {flowId === null ? (
        <p role="note" className="rounded-xl bg-muted p-2.5 text-[12px]">
          {t('saveFlowFirst')}
        </p>
      ) : summary.isSuccess && summary.data.total === 0 ? (
        <p role="note" className="rounded-xl bg-muted p-2.5 text-[12px]">
          {t.rich('noFaqs', { link: page('new') })}
        </p>
      ) : null}
      <Field label={t('query')} hint={t.rich('queryHint', { mono: code, variable: '{{answer}}' })}>
        <Input
          className="font-mono"
          value={str(step.data.query)}
          placeholder={FAQ_DEFAULT_QUERY}
          onChange={(e) => set({ query: e.target.value })}
        />
      </Field>
      <Field
        label={t('category')}
        hint={
          <>
            {summary.isError ? `${t('categoriesFailed')} ` : ''}
            {t('categoryHint')}
          </>
        }
      >
        <Select value={category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">{summary.isPending ? t('loadingCategories') : t('allFaqs')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          {category && !categories.includes(category) ? (
            <option value={category}>{t('categoryGone', { name: category })}</option>
          ) : null}
        </Select>
      </Field>
      <Field
        label={t('minScore')}
        hint={t.rich('minScoreHint', { ...FAQ_MIN_SCORE, link: page('test') })}
      >
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={!own}
            onChange={(e) => set({ minScore: e.target.checked ? null : FAQ_MIN_SCORE_START })}
          />
          {t('useWorkspaceScore')}
        </label>
        {own ? (
          <Input
            className="mt-2"
            type="number"
            min={FAQ_MIN_SCORE.min}
            max={FAQ_MIN_SCORE.max}
            step={0.01}
            aria-label={t('minScore')}
            invalid={outOfRange}
            value={step.data.minScore === '' ? '' : str(step.data.minScore)}
            onChange={(e) => set({ minScore: e.target.value === '' ? '' : Number(e.target.value) })}
          />
        ) : null}
        {outOfRange ? (
          <p role="alert" className="mt-1.5 text-[11.5px] text-danger">
            {t('minScoreInvalid', FAQ_MIN_SCORE)}
          </p>
        ) : null}
      </Field>
      <Field label={t('sendAnswer')} hint={send ? t('sendAnswerOnHint') : t('sendAnswerOffHint')}>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={send}
            onChange={(e) => set({ sendAnswer: e.target.checked })}
          />
          {t('sendAnswerToggle')}
        </label>
      </Field>
      <Field label={t('save')} hint={t('saveHint')}>
        <Input
          className="font-mono"
          value={str(step.data.save)}
          placeholder="faq"
          onChange={(e) => set({ save: slug(e.target.value) })}
        />
        <ul className="mt-2 space-y-1 text-[11.5px] text-muted-foreground">
          {FAQ_VARIABLES.map((name) => (
            <li key={name}>
              <code className="font-mono">{`{{${save}.${name}}}`}</code> {t(`variables.${name}`)}
            </li>
          ))}
        </ul>
      </Field>
      {(['matched', 'no_match'] as const).map((handle, i) => (
        <Field key={handle} label={ts(`exits.${handle}`)} hint={ts(`exitsHint.${handle}`)}>
          <LinkSelect
            doc={doc}
            stepId={step.id}
            value={step.links[i] ?? null}
            onChange={(target) => link(i, target)}
          />
        </Field>
      ))}
    </div>
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

/** What a template button opens, for the list under the preview: the phone number, the link or the copied code. */
const buttonTarget = (b: Record<string, unknown>): string =>
  str(b.value ?? b.phone_number ?? b.phone ?? b.url ?? b.example);

function TemplateEditor({ step, ctx, set }: EditorProps) {
  const t = useTranslations('flb.builder.simple.editors');
  const chosen = ctx.templates.find((x) => x.name === str(step.data.tpl));
  const buttons = (chosen?.buttons ?? []) as Array<Record<string, unknown>>;
  const variables = chosen?.variables ?? [];
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
      {chosen ? <TemplatePreview d={step.data} templates={ctx.templates} /> : null}
      {buttons.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[12px] font-medium text-muted-foreground">
            {t('template.buttons')}
          </div>
          {buttons.map((b, i) => (
            <div
              key={i}
              className="flex items-baseline justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-[12.5px]"
            >
              <span className="font-semibold">{str(b.text ?? b.title ?? b.label)}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {buttonTarget(b)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {variables.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[12px] font-medium text-muted-foreground">
            {t('template.variables')}
          </div>
          {variables.map((v) => (
            <div
              key={`${v.section}-${v.slot}`}
              className="flex items-baseline justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-[12.5px]"
            >
              <span className="font-mono">{`{{${v.slot}}}`}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {v.field}
              </span>
            </div>
          ))}
          <p className="text-[11.5px] text-muted-foreground">{t('template.variablesHint')}</p>
        </div>
      ) : null}
    </div>
  );
}

const CTA_KINDS = ['url', 'phone', 'email'] as const;
const CTA_MAX = 3;
/** The name a new button of each kind starts with. */
const CTA_DEFAULT_LABEL: Record<string, string> = {
  url: 'Visit website',
  phone: 'Call us',
  email: 'Email us',
};

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
  // Switching what a button opens swaps its stock name too (an untouched "Visit website" becomes "Call us"). The old address is
  // kept only when it is already valid for the new kind (or turns into it: "mailto:a@b.co" / "tel:+91..." lose the scheme);
  // otherwise it is cleared, so no web address is left in a phone or email field. A name the author wrote is kept.
  const carryValue = (value: string, to: string) => {
    const v = value.trim().replace(/^(mailto|tel):/i, '');
    return ctaLinkProblem(to, v) === null ? v : '';
  };
  const switchKind = (i: number, from: string, to: string) =>
    patch(i, {
      type: to,
      value: carryValue(str(actions[i]?.value), to),
      ...(!str(actions[i]?.label).trim() || str(actions[i]?.label) === CTA_DEFAULT_LABEL[from]
        ? { label: CTA_DEFAULT_LABEL[to] }
        : {}),
    });
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
        const problem = ctaLinkProblem(kind, a.value);
        return (
          <Row key={i}>
            <div className="space-y-3">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label={t('cta.type')}>
                    <Select value={kind} onChange={(e) => switchKind(i, kind, e.target.value)}>
                      {CTA_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`cta.kinds.${k}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="pb-1">
                  <RemoveBtn
                    label={t('cta.remove')}
                    disabled={actions.length <= 1}
                    onClick={() => setAll(actions.filter((_, j) => j !== i))}
                  />
                </div>
              </div>
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
                error={problem ? t(`cta.errors.${problem}`) : undefined}
              >
                <Input
                  value={str(a.value)}
                  placeholder={holder(kind)}
                  type={kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'url'}
                  inputMode={kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'url'}
                  invalid={!!problem}
                  onChange={(e) => patch(i, { value: e.target.value })}
                />
              </Field>
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
