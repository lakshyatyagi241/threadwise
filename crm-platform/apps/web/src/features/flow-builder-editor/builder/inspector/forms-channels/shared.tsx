'use client';

import type { ReactNode } from 'react';
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
import { flowOptionLabel, handoffFlows, withSavedOption } from './helpers';

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

export function RemoveButton({
  onClick,
  title = 'Remove',
}: {
  onClick: () => void;
  title?: string;
}) {
  return (
    <IconButton onClick={onClick} title={title} danger>
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
export function aiModelOptions(p: FormProps): Opt[] {
  const { aiModels } = p.env.ctx;
  const opts: Opt[] = aiModels.length
    ? [{ v: '', l: '— pick model —' }, ...aiModels.map((m) => ({ v: m.value, l: m.label }))]
    : [{ v: '', l: 'No AI models enabled — ask admin' }];
  const model = p.data.model;
  if (model && !aiModels.some((m) => m.value === model))
    opts.push({ v: String(model), l: `${String(model)} (not enabled)` });
  return opts;
}

export function knowledgeBaseOptions(p: FormProps): Opt[] {
  const opts: Opt[] = [
    { v: '', l: '— none (prompt only) —' },
    ...p.env.ctx.assistants.map((a) => ({ v: a.id, l: `${a.name} · ${a.sources} src` })),
  ];
  return withSavedOption(opts, p.data.assistant, (id) => `Assistant ${id.slice(0, 8)}`);
}

export function voiceAssistantOptions(p: FormProps, key: string, first: string): Opt[] {
  const opts: Opt[] = [
    { v: '', l: first },
    ...p.env.ctx.callAssistants.map((a) => ({ v: a.id, l: a.name })),
  ];
  return withSavedOption(opts, p.data[key], (id) => `Assistant ${id.slice(0, 8)}`);
}

/** Order / Details toggles with their label inputs, shared by the Instagram and Facebook product nodes. */
export function OrderDetailsFields({ p, detailsHint }: { p: FormProps; detailsHint: string }) {
  const orderOn = p.data.orderButton !== false;
  const detailsOn = p.data.detailsButton !== false;
  return (
    <>
      <Field
        label="Order button"
        hint={
          <>
            Tapping it sends <Mono>ORDER_&lt;product&gt;</Mono> — the ordering flow / keyword rule
            picks it up.
          </>
        }
      >
        <div className="mb-1.5">
          <Check checked={orderOn} onChange={(v) => p.set('orderButton', v)}>
            Show an “Order” button on each card
          </Check>
        </div>
        {orderOn ? Txt(p, 'orderLabel', 'Order') : null}
      </Field>
      <Field label="Details button" hint={detailsHint}>
        <div className="mb-1.5">
          <Check checked={detailsOn} onChange={(v) => p.set('detailsButton', v)}>
            Show a “View” link to the product page
          </Check>
        </div>
        {detailsOn ? Txt(p, 'detailsLabel', 'View') : null}
      </Field>
    </>
  );
}

/** "Capture lead" form, identical for Instagram and Facebook except for the intro wording. */
export function LeadForm({ p, askName }: { p: FormProps; askName: string }) {
  return (
    <>
      <Notice className="mb-3">
        Maps variables collected by earlier <Mono>{askName}</Mono> nodes into a saved lead. Leave a
        field blank to skip it.
      </Notice>
      <Field label="Name from variable">{Txt(p, 'nameVar', 'lead_name')}</Field>
      <Field label="Email from variable">{Txt(p, 'emailVar', 'lead_email')}</Field>
      <Field label="Phone from variable">{Txt(p, 'phoneVar', 'lead_phone')}</Field>
      <Field label="Notes from variable (optional)">{Txt(p, 'notesVar', '')}</Field>
      <Field
        label="Sales Pipeline"
        hint="The lead is added to your default pipeline so nothing slips through."
      >
        <Check checked={p.data.createDeal !== false} onChange={(v) => p.set('createDeal', v)}>
          Create a pipeline deal for every lead
        </Check>
      </Field>
      <Field label="Thank-you message (optional)" hint="Sent right after the lead is saved.">
        {Ta(p, 'ack', 'Thanks! Our team will reach out shortly.', 2)}
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
  const mode = p.data.mode === 'direct' ? 'direct' : 'deeplink';
  const flows = handoffFlows(p.env.ctx.flows, excludeChannels);
  const waFlowOpts = withSavedOption(
    [
      { v: '', l: flows.length ? '— pick WhatsApp flow —' : 'No WhatsApp flows yet' },
      ...flows.map((f) => ({ v: f.id, l: flowOptionLabel(f.name, f.isPublished) })),
    ],
    p.data.waFlowId,
    (id) => `Flow ${id.slice(0, 8)}`,
  );
  return (
    <>
      <div className="mb-3 rounded-lg border border-[#A7E8C0] bg-[#DCFCE7] p-2.5 text-[11.5px] leading-snug text-[#14532D]">
        Move this {surface} to WhatsApp. {platform} and WhatsApp identities aren&apos;t linked, so
        the person has to reach your WhatsApp themselves (deep link) or give you their number first.
      </div>
      <Field label="Handoff method">
        {Sel(p, 'mode', [
          { v: 'deeplink', l: 'Deep link — send a wa.me link (recommended, safe)' },
          { v: 'direct', l: 'Direct — start a WhatsApp flow to a captured number' },
        ])}
      </Field>
      {mode === 'deeplink' ? (
        <>
          <Field
            label="Your WhatsApp number"
            hint="Digits only, country code first. The wa.me link opens a chat to this number."
          >
            {Txt(p, 'waNumber', '15551234567')}
          </Field>
          <Field
            label="Pre-filled message"
            hint="Text WhatsApp pre-fills for the user. Make it match a WhatsApp keyword-trigger flow so it auto-starts."
          >
            {Txt(p, 'prefillText', prefillDefault)}
          </Field>
          <Field
            label={`DM shown on ${platform}`}
            hint={`The ${dmName} DM sent with the wa.me link. Supports {{variables}}.`}
          >
            {Ta(p, 'introText', "Let's continue on WhatsApp 👇", 2)}
          </Field>
        </>
      ) : (
        <>
          <Notice tone="warn" className="mb-3">
            ⚠ Meta only lets you message a WhatsApp number that has opted in or messaged you in the
            last 24h. If it hasn&apos;t, the first message is blocked. Prefer the deep-link method
            unless you know the number opted in.
          </Notice>
          <Field
            label="WhatsApp number from variable"
            hint={
              'A flow variable captured earlier (e.g. an Ask node "What\'s your WhatsApp number?").'
            }
          >
            {Txt(p, 'numberVar', 'wa_number')}
          </Field>
          <Field
            label="WhatsApp flow to start"
            hint="The WhatsApp flow that runs for that number once handed off."
          >
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
