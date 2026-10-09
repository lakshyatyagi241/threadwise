'use client';

import { useTranslations } from 'next-intl';
import { offerSenders } from '@/lib/unofficial-whatsapp';
import type { ReactNode } from 'react';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import { flowTypeLabel } from '../../../lib/contract-text';
import { useFlb } from '../../../lib/msg';
import { Field, Notice, SelectInput, TextInput, type Opt } from '../kit';
import type { FormProps } from '../types';
import {
  asArray,
  resolveTriggerChannel,
  senderHint,
  senderLabel,
  senderNoneCopy,
  senderOptions,
  senderPickKey,
  str,
  toggleId,
} from './helpers';
import { Link, LinkedText } from './parts';

/** The trigger kinds every channel offers; their labels are the messages `trigger.kind.<id>`. */
const KIND_OPTIONS = [
  'keyword',
  'tag_added',
  'group_join',
  'contact_created',
  'opt_in',
  'order_placed',
  'deal_stage_changed',
  'away',
  'out_of_hours',
  'manual_enroll',
];

export function TriggerForm({ data: d, set, setMany, env }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.trigger');
  const th = useTranslations('flb.builder.formsCore.helpers');
  const tf = useFlb();
  const { ctx, loading } = env;
  const unofficial = useUnofficialWhatsapp();
  const channel = resolveTriggerChannel(d.channel, env.channels, env.mode);
  const isIg = channel === 'instagram';
  const kind = str(d.kind);

  const tagOpts: Opt[] = [
    { v: '', l: loading ? t('tagsLoading') : t('tagPick') },
    ...ctx.tags.map((tag) => ({ v: tag.id, l: tag.name || t('tagFallback') })),
  ];
  const groupOpts: Opt[] = [
    { v: '', l: loading ? t('groupsLoading') : t('groupPick') },
    ...ctx.groups.map((g) => ({ v: g.id, l: g.name || t('groupFallback') })),
  ];
  const stageOpts: Opt[] = [
    { v: '', l: loading ? t('stagesLoading') : t('stagePick') },
    ...ctx.stages.map((s) => ({ v: s.id, l: s.name })),
  ];

  // Personal-number (unofficial) senders are not offered while the platform has that engine off; the official ones stay.
  const senders = offerSenders(ctx.senders[channel], unofficial);
  const senderChosen = str(d.deviceId).trim() !== '';
  const senderMissing = !senderChosen && senders.length > 0;
  const senderNone = !senderChosen && senders.length === 0;
  const hint = senderHint(channel, unofficial);

  const showChannel = env.openedAs !== 'call' && env.channels.length >= 2;
  const channelOpts: Opt[] = env.channels
    .filter((c) => c !== 'call')
    .map((c) => ({ v: c, l: flowTypeLabel(tf, c) }));

  const selectedRules = asArray(d.keywordRuleIds).map(String);
  const kindOpts: Opt[] = [...(isIg ? ['comment_to_dm'] : []), ...KIND_OPTIONS].map((id) => ({
    v: id,
    l: t(`kind.${id}`),
  }));
  const b = (chunks: ReactNode) => <b>{chunks}</b>;

  return (
    <>
      {showChannel ? (
        <Field label={t('channelLabel')} hint={t('channelHint')}>
          <SelectInput
            value={channel}
            options={channelOpts}
            onChange={(v) => setMany({ channel: v, deviceId: '' })}
          />
        </Field>
      ) : null}

      <Field label={t('startLabel')}>
        <SelectInput value={kind} options={kindOpts} onChange={(v) => set('kind', v)} />
      </Field>

      {kind === 'keyword' ? (
        <Field
          label={t('whenLabel')}
          hint={d.keywordMode === 'any' ? t('whenHintAny') : t('whenHintKeywords')}
        >
          <SelectInput
            value={d.keywordMode}
            options={[
              { v: 'keywords', l: t('modeKeywords') },
              { v: 'any', l: t('modeAny') },
            ]}
            onChange={(v) => set('keywordMode', v)}
          />
        </Field>
      ) : null}

      {kind === 'keyword' && d.keywordMode !== 'any' ? (
        <Field label={t('keywordsLabel')} hint={t('keywordsHint')}>
          <TextInput
            value={d.keywords}
            placeholder={t('keywordsPlaceholder')}
            onChange={(v) => set('keywords', v)}
          />
        </Field>
      ) : null}

      {kind === 'tag_added' ? (
        <Field label={t('tagLabel')} hint={t('tagHint')}>
          <SelectInput value={d.tagId} options={tagOpts} onChange={(v) => set('tagId', v)} />
        </Field>
      ) : null}

      {kind === 'group_join' ? (
        <Field label={t('groupLabel')} hint={t('groupHint')}>
          <SelectInput value={d.groupId} options={groupOpts} onChange={(v) => set('groupId', v)} />
        </Field>
      ) : null}

      {kind === 'deal_stage_changed' ? (
        <Field label={t('stageLabel')} hint={t('stageHint')}>
          <SelectInput value={d.stageId} options={stageOpts} onChange={(v) => set('stageId', v)} />
        </Field>
      ) : null}

      {kind === 'comment_to_dm' ? (
        <Field label={t('rulesLabel')} hint={t('rulesHint')}>
          {ctx.keywordRules.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-snug text-amber-800">
              {t.rich('rulesNone', {
                link: (chunks) => (
                  <Link href="/auto-reply" strong>
                    {chunks}
                  </Link>
                ),
              })}
            </div>
          ) : (
            <div className="max-h-52 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-background">
              {ctx.keywordRules.map((r) => (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[12px] hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={selectedRules.includes(r.id)}
                    onChange={() => set('keywordRuleIds', toggleId(selectedRules, r.id))}
                    className="rounded border-border text-brand focus:ring-brand/30"
                  />
                  <span className="flex-1 truncate">
                    {r.keyword || t('ruleFallback', { id: r.id.slice(0, 8) })}
                  </span>
                  {!r.active ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[9.5px] text-muted-foreground">
                      {t('ruleOff')}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          )}
        </Field>
      ) : null}

      {kind === 'order_placed' ? <Notice>{t('orderPlaced')}</Notice> : null}
      {kind === 'contact_created' || kind === 'opt_in' ? <Notice>{t('automatic')}</Notice> : null}
      {kind === 'away' ? (
        <Notice>
          {t.rich('away', {
            b,
            link: (chunks) => <Link href="/auto-reply">{chunks}</Link>,
          })}
        </Notice>
      ) : null}
      {kind === 'out_of_hours' ? <Notice>{t.rich('outOfHours', { b })}</Notice> : null}
      {kind === 'manual_enroll' ? (
        <Notice>
          {t.rich('manualEnroll', {
            b,
            link: (chunks) => <Link href="/flows">{chunks}</Link>,
          })}
        </Notice>
      ) : null}

      <Field label={senderLabel(th, channel, kind)} hint={<LinkedText copy={hint} />}>
        <SelectInput
          value={d.deviceId}
          options={senderOptions(th, channel, senders)}
          onChange={(v) => set('deviceId', v)}
        />
      </Field>
      {senderMissing ? (
        <Notice tone="danger" className="-mt-2">
          {th(senderPickKey(channel))}
        </Notice>
      ) : null}
      {senderNone ? (
        <Notice tone="warn" className="-mt-2">
          <LinkedText copy={senderNoneCopy(channel, unofficial)} strong />
        </Notice>
      ) : null}
    </>
  );
}
