'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import {
  Check,
  Field,
  IconButton,
  NumberInput,
  Notice,
  SelectInput,
  TextArea,
  TextInput,
  XIcon,
  controlClass,
} from '../kit';
import type { Opt } from '../kit';
import type { FormProps } from '../types';
import { flowOptionLabel, handoffFlows, withSavedOption, type HelperT } from './helpers';

const NS = 'flb.builder.formsChannels.shared';

/** The `flb.builder.formsChannels.shared` translator, passed to the option builders below by the forms that call them. */
export type SharedT = HelperT;

/** Field-bound controls: Reference's `Txt`, `Ta`, `Num` and `Sel` helpers, reading and writing `data[key]`. */
export function Txt({ data, set }: FormProps, key: string, placeholder?: string, mono?: boolean) {
  return (
    <TextInput
      value={data[key]}
      onChange={(v) => set(key, v)}
      placeholder={placeholder}
      mono={mono}
    />
  );
}

export function Ta({ data, set }: FormProps, key: string, placeholder?: string, rows = 4) {
  return (
    <TextArea
      value={data[key]}
      onChange={(v) => set(key, v)}
      placeholder={placeholder}
      rows={rows}
    />
  );
}

export function Num(
  { data, set }: FormProps,
  key: string,
  placeholder?: string,
  range?: { min?: number; max?: number },
) {
  return (
    <NumberInput
      value={data[key]}
      onChange={(v) => set(key, v)}
      placeholder={placeholder}
      min={range?.min}
      max={range?.max}
    />
  );
}

export function Sel({ data, set }: FormProps, key: string, options: Opt[]) {
  return <SelectInput value={data[key]} onChange={(v) => set(key, v)} options={options} />;
}

/** A link to another part of the product, styled like Reference's inline `text-wa-deep underline` anchors. */
export const ExtLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} className="text-brand underline">
    {children}
  </a>
);

/**
 * Reference's "Add ..." control in these forms: a bold green text link with a plus (`plain`: the smaller "+ Add column" text
 * link of the Sheets and Docs forms), not the bordered pill other forms use.
 */
export function AddLink({
  onClick,
  children,
  plain,
}: {
  onClick: () => void;
  children: ReactNode;
  plain?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-brand hover:underline',
        plain ? 'text-[11.5px]' : 'inline-flex items-center gap-1 text-[12px] font-semibold',
      )}
    >
      {plain ? (
        <>+ {children}</>
      ) : (
        <>
          <svg
            viewBox="0 0 16 16"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
          {children}
        </>
      )}
    </button>
  );
}

/** The plus drawn in front of Reference's dashed "Pick products" / "Create new AI agent" buttons. */
export const PlusIcon = () => (
  <svg
    viewBox="0 0 16 16"
    className="h-3.5 w-3.5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
  >
    <path d="M8 3v10M3 8h10" strokeLinecap="round" />
  </svg>
);

export const Mono = ({ children }: { children: ReactNode }) => (
  <span className="font-mono">{children}</span>
);

/** The grey explanation box at the top of a form, with an optional smaller second line. */
export function Intro({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <Notice className="mb-3">
      {children}
      {sub ? <div className="mt-1 text-[10.5px] text-muted-foreground">{sub}</div> : null}
    </Notice>
  );
}

/** A compact input for the repeated rows (branches, quick replies, columns). */
export function RowInput({
  value,
  onChange,
  placeholder,
  mono,
  className,
}: {
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(controlClass, 'px-2.5 py-1.5 text-[12px]', mono && 'font-mono', className)}
    />
  );
}

export function RemoveButton({ onClick, title }: { onClick: () => void; title?: string }) {
  const t = useTranslations(NS);
  return (
    <IconButton onClick={onClick} title={title ?? t('remove')} danger>
      <XIcon />
    </IconButton>
  );
}

/** Reads an array field of objects, ignoring anything that is not an object. */
export function readRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map((v) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}))
    : [];
}

/** Model + knowledge-base dropdowns shared by the AI nodes (the options Reference builds from its AI caches). */
export function aiModelOptions(p: FormProps, t: SharedT): Opt[] {
  const { aiModels } = p.env.ctx;
  const opts: Opt[] = aiModels.length
    ? [{ v: '', l: t('pickModel') }, ...aiModels.map((m) => ({ v: m.value, l: m.label }))]
    : [{ v: '', l: t('noModels') }];
  const model = p.data.model;
  if (model && !aiModels.some((m) => m.value === model))
    opts.push({ v: String(model), l: t('modelNotEnabled', { model: String(model) }) });
  return opts;
}

export function knowledgeBaseOptions(p: FormProps, t: SharedT): Opt[] {
  const opts: Opt[] = [
    { v: '', l: t('noKnowledgeBase') },
    ...p.env.ctx.assistants.map((a) => ({
      v: a.id,
      l: t('knowledgeBase', { name: a.name, sources: a.sources }),
    })),
  ];
  return withSavedOption(opts, p.data.assistant, (id) =>
    t('savedAssistant', { id: id.slice(0, 8) }),
  );
}

export function voiceAssistantOptions(p: FormProps, key: string, first: string, t: SharedT): Opt[] {
  const opts: Opt[] = [
    { v: '', l: first },
    ...p.env.ctx.callAssistants.map((a) => ({ v: a.id, l: a.name })),
  ];
  return withSavedOption(opts, p.data[key], (id) => t('savedAssistant', { id: id.slice(0, 8) }));
}

/** Order / Details toggles with their label inputs, shared by the Instagram and Facebook product nodes. */
export function OrderDetailsFields({ p, detailsHint }: { p: FormProps; detailsHint: string }) {
  const t = useTranslations(NS);
  const orderOn = p.data.orderButton !== false;
  const detailsOn = p.data.detailsButton !== false;
  return (
    <>
      <Field
        label={t('orderButton')}
        hint={t.rich('orderButtonHint', {
          token: 'ORDER_<product>',
          mono: (c) => <Mono>{c}</Mono>,
        })}
      >
        <div className="mb-1.5">
          <Check checked={orderOn} onChange={(v) => p.set('orderButton', v)}>
            {t('showOrder')}
          </Check>
        </div>
        {orderOn ? Txt(p, 'orderLabel', t('orderLabelPlaceholder')) : null}
      </Field>
      <Field label={t('detailsButton')} hint={detailsHint}>
        <div className="mb-1.5">
          <Check checked={detailsOn} onChange={(v) => p.set('detailsButton', v)}>
            {t('showView')}
          </Check>
        </div>
        {detailsOn ? Txt(p, 'detailsLabel', t('viewLabelPlaceholder')) : null}
      </Field>
    </>
  );
}

/** "Capture lead" form, identical for Instagram and Facebook except for the intro wording. */
export function LeadForm({ p, askName }: { p: FormProps; askName: string }) {
  const t = useTranslations(NS);
  return (
    <>
      <Notice className="mb-3">
        {t.rich('leadIntro', { askName, mono: (c) => <Mono>{c}</Mono> })}
      </Notice>
      <Field label={t('nameFromVariable')}>{Txt(p, 'nameVar', 'lead_name')}</Field>
      <Field label={t('emailFromVariable')}>{Txt(p, 'emailVar', 'lead_email')}</Field>
      <Field label={t('phoneFromVariable')}>{Txt(p, 'phoneVar', 'lead_phone')}</Field>
      <Field label={t('notesFromVariable')}>{Txt(p, 'notesVar', '')}</Field>
      <Field label={t('salesPipeline')} hint={t('salesPipelineHint')}>
        <Check checked={p.data.createDeal !== false} onChange={(v) => p.set('createDeal', v)}>
          {t('createDeal')}
        </Check>
      </Field>
      <Field label={t('thankYou')} hint={t('thankYouHint')}>
        {Ta(p, 'ack', t('thankYouPlaceholder'), 2)}
      </Field>
    </>
  );
}

/** Cross-channel handoff to WhatsApp (Instagram and Messenger share it). */
export function WhatsappHandoffForm({
  p,
  platform,
  surface,
  dmName,
  excludeChannels,
  prefillDefault,
}: {
  p: FormProps;
  /** "Instagram" / "Facebook" */
  platform: string;
  /** "Instagram conversation" / "Messenger conversation" */
  surface: string;
  /** How the hint names the DM: Reference says "IG DM" on Instagram and "Messenger DM" on Facebook. */
  dmName: string;
  /** Flow channels this node does not offer as the WhatsApp flow to start (Reference's per-channel exclusion list, quirks included). */
  excludeChannels: readonly string[];
  prefillDefault: string;
}) {
  const t = useTranslations(NS);
  const th = useTranslations('flb.builder.formsChannels.helpers');
  const mode = p.data.mode === 'direct' ? 'direct' : 'deeplink';
  const flows = handoffFlows(p.env.ctx.flows, excludeChannels);
  const waFlowOpts = withSavedOption(
    [
      { v: '', l: flows.length ? t('pickWaFlow') : t('noWaFlows') },
      ...flows.map((f) => ({ v: f.id, l: flowOptionLabel(f.name, f.isPublished, th) })),
    ],
    p.data.waFlowId,
    (id) => t('savedFlow', { id: id.slice(0, 8) }),
  );
  return (
    <>
      <div className="mb-3 rounded-lg border border-[#A7E8C0] bg-[#DCFCE7] p-2.5 text-[11.5px] leading-snug text-[#14532D]">
        {t('handoffIntro', { surface, platform })}
      </div>
      <Field label={t('handoffMethod')}>
        {Sel(p, 'mode', [
          { v: 'deeplink', l: t('methodDeeplink') },
          { v: 'direct', l: t('methodDirect') },
        ])}
      </Field>
      {mode === 'deeplink' ? (
        <>
          <Field label={t('waNumber')} hint={t('waNumberHint')}>
            {Txt(p, 'waNumber', '15551234567')}
          </Field>
          <Field label={t('prefill')} hint={t('prefillHint')}>
            {Txt(p, 'prefillText', prefillDefault)}
          </Field>
          <Field label={t('dmShown', { platform })} hint={t('dmHint', { dmName })}>
            {Ta(p, 'introText', t('introPlaceholder'), 2)}
          </Field>
        </>
      ) : (
        <>
          <Notice tone="warn" className="mb-3">
            {t('directWarning')}
          </Notice>
          <Field label={t('numberFromVariable')} hint={t('numberFromVariableHint')}>
            {Txt(p, 'numberVar', 'wa_number')}
          </Field>
          <Field label={t('waFlowToStart')} hint={t('waFlowToStartHint')}>
            <SelectInput
              value={p.data.waFlowId}
              onChange={(v) => p.set('waFlowId', v)}
              options={waFlowOpts}
            />
          </Field>
        </>
      )}
    </>
  );
}
