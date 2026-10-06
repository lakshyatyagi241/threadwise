'use client';

import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import { Field, RowCard, TextArea, TextInput } from '../kit';
import type { FormProps } from '../types';
import {
  changeCtaType,
  CTA_MAX_ACTIONS,
  ctaActions,
  ctaPlaceholder,
  moveItem,
  patchItem,
  suggestedCtaLabel,
  type CtaAction,
} from './helpers';
import { AddLink, CardHeader, InfoBox } from './parts';
import { CtaPreview, LocationPreview } from './previews';

const CTA_TYPES = [
  { v: 'url', l: 'Visit website' },
  { v: 'phone', l: 'Call' },
  { v: 'call_now', l: 'Call now' },
  { v: 'copy', l: 'Copy code' },
];

function ctaHint(type: string, unofficial: boolean): string {
  if (type === 'phone' || type === 'call_now') {
    return 'Include the country code (e.g. +1…). The customer taps to dial. Note: on WhatsApp Official (Cloud API), a Call in a flow shows as a tappable number, NOT a native button — WhatsApp only allows Call buttons inside approved Templates. Only URL buttons render as native buttons in a flow.';
  }
  if (type === 'copy') {
    return 'The customer long-presses the code to copy. Good for coupons, OTPs, referral codes. Note: on WhatsApp Official (Cloud API) this shows as tappable text in a flow, not a native button (Copy buttons are Template-only).';
  }
  return unofficial
    ? 'The customer taps the button to open this URL. On WhatsApp Official this renders as a native tap button; on the Unofficial API it appears as a tappable link.'
    : 'The customer taps the button to open this URL. On WhatsApp Official this renders as a native tap button.';
}

export function CtaForm({ data: d, set, env }: FormProps) {
  const unofficial = useUnofficialWhatsapp();
  const actions = ctaActions(d);
  const setActions = (next: CtaAction[]) => set('actions', next);
  const patch = (i: number, p: Partial<CtaAction>) => setActions(patchItem(actions, i, p));
  const add = () => {
    if (actions.length >= CTA_MAX_ACTIONS) {
      env.toast('Max 3 buttons per CTA');
      return;
    }
    setActions([...actions, { type: 'url', label: suggestedCtaLabel('url'), value: '' }]);
  };
  return (
    <>
      <CtaPreview d={d} />
      <InfoBox>
        Add up to 3 CTA buttons in one message — mix Visit website, Call, and Copy code in any
        combination. Same cap WhatsApp template buttons have.
      </InfoBox>
      {actions.map((a, i) => {
        const type = a.type || 'url';
        return (
          <RowCard key={i}>
            <CardHeader
              index={i}
              isFirst={i === 0}
              isLast={i === actions.length - 1}
              onMove={(dir) => setActions(moveItem(actions, i, dir))}
              onRemove={() => setActions(actions.filter((_, j) => j !== i))}
            >
              <select
                value={type}
                onChange={(e) =>
                  setActions(
                    actions.map((x, j) => (j === i ? changeCtaType(x, e.target.value) : x)),
                  )
                }
                className="rounded border border-border bg-background px-2 py-1 text-[11.5px] outline-none focus:border-brand"
              >
                {CTA_TYPES.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
            </CardHeader>
            <div className="space-y-2 p-3">
              <TextInput
                value={a.label}
                onChange={(v) => patch(i, { label: v })}
                placeholder="Button label"
              />
              <TextInput
                value={a.value}
                onChange={(v) => patch(i, { value: v })}
                placeholder={ctaPlaceholder(type)}
                mono
              />
              <div className="text-[10.5px] leading-snug text-muted-foreground">
                {ctaHint(type, unofficial)}
              </div>
            </div>
          </RowCard>
        );
      })}
      {actions.length < CTA_MAX_ACTIONS ? (
        <AddLink onClick={add}>Add button</AddLink>
      ) : (
        <div className="mt-1 text-[11px] italic text-muted-foreground">Max 3 buttons reached.</div>
      )}
    </>
  );
}

export function LocationForm({ data: d, set }: FormProps) {
  return (
    <>
      <LocationPreview d={d} />
      <Field label="Title">
        <TextInput value={d.title} placeholder="Our office" onChange={(v) => set('title', v)} />
      </Field>
      <Field label="Address">
        <TextArea
          value={d.address}
          placeholder="Street, city, country"
          rows={2}
          onChange={(v) => set('address', v)}
        />
      </Field>
      <div className="mb-1 grid grid-cols-2 gap-2">
        <Field label="Latitude">
          <TextInput value={d.lat} placeholder="12.9716" onChange={(v) => set('lat', v)} />
        </Field>
        <Field label="Longitude">
          <TextInput value={d.lng} placeholder="77.5946" onChange={(v) => set('lng', v)} />
        </Field>
      </div>
    </>
  );
}
