'use client';

import { ButtonIcon } from '../../button-icon';
import { useContext } from 'react';
import { useTranslations } from 'next-intl';
import { FLB_WA_LIMITS } from '@crm/contracts';
import { FlowEditorContext } from '../../../lib/flow-editor-context';
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

const CTA_TYPES = ['url', 'phone', 'call_now', 'copy'] as const;

/** The key (under `ctaHint`) of the hint below an action: Call and Copy are not native buttons on WhatsApp Official. */
function ctaHintKey(type: string, unofficial: boolean): string {
  if (type === 'phone' || type === 'call_now') return 'phone';
  if (type === 'copy') return 'copy';
  return unofficial ? 'urlUnofficial' : 'urlOfficial';
}

export function CtaForm({ data: d, set, env }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.engage');
  const th = useTranslations('flb.builder.formsCore.helpers');
  const unofficial = useUnofficialWhatsapp();
  const { whatsapp } = useContext(FlowEditorContext);
  const actions = ctaActions(d);
  const setActions = (next: CtaAction[]) => set('actions', next);
  const patch = (i: number, p: Partial<CtaAction>) => setActions(patchItem(actions, i, p));
  const add = () => {
    if (actions.length >= CTA_MAX_ACTIONS) {
      env.toast(t('maxToast', { max: CTA_MAX_ACTIONS }));
      return;
    }
    setActions([...actions, { type: 'url', label: suggestedCtaLabel(th, 'url'), value: '' }]);
  };
  return (
    <>
      <CtaPreview d={d} />
      <InfoBox>{t('info', { max: CTA_MAX_ACTIONS })}</InfoBox>
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
                    actions.map((x, j) => (j === i ? changeCtaType(th, x, e.target.value) : x)),
                  )
                }
                className="rounded border border-border bg-background px-2 py-1 text-[11.5px] outline-none focus:border-brand"
              >
                {CTA_TYPES.map((o) => (
                  <option key={o} value={o}>
                    {t(`ctaType.${o}`)}
                  </option>
                ))}
              </select>
            </CardHeader>
            <div className="space-y-2 p-3">
              <TextInput
                value={a.label}
                maxLength={whatsapp ? FLB_WA_LIMITS.ctaText : undefined}
                onChange={(v) => patch(i, { label: v })}
                placeholder={t('buttonLabel')}
              />
              <TextInput
                value={a.value}
                maxLength={whatsapp && type === 'url' ? FLB_WA_LIMITS.ctaUrl : undefined}
                onChange={(v) => patch(i, { value: v })}
                placeholder={ctaPlaceholder(type)}
                mono
              />
              <div className="text-[10.5px] leading-snug text-muted-foreground">
                {t(`ctaHint.${ctaHintKey(type, unofficial)}`)}
              </div>
              <ButtonIcon value={a.icon ?? ''} onChange={(v) => patch(i, { icon: v })} />
            </div>
          </RowCard>
        );
      })}
      {actions.length < CTA_MAX_ACTIONS ? (
        <AddLink onClick={add}>{t('addButton')}</AddLink>
      ) : (
        <div className="mt-1 text-[11px] italic text-muted-foreground">
          {t('maxReached', { max: CTA_MAX_ACTIONS })}
        </div>
      )}
    </>
  );
}

export function LocationForm({ data: d, set }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.engage');
  return (
    <>
      <LocationPreview d={d} />
      <Field label={t('locationTitle')}>
        <TextInput
          value={d.title}
          placeholder={t('locationTitlePlaceholder')}
          onChange={(v) => set('title', v)}
        />
      </Field>
      <Field label={t('locationAddress')}>
        <TextArea
          value={d.address}
          placeholder={t('locationAddressPlaceholder')}
          rows={2}
          onChange={(v) => set('address', v)}
        />
      </Field>
      <div className="mb-1 grid grid-cols-2 gap-2">
        <Field label={t('locationLatitude')}>
          <TextInput value={d.lat} placeholder="12.9716" onChange={(v) => set('lat', v)} />
        </Field>
        <Field label={t('locationLongitude')}>
          <TextInput value={d.lng} placeholder="77.5946" onChange={(v) => set('lng', v)} />
        </Field>
      </div>
    </>
  );
}
