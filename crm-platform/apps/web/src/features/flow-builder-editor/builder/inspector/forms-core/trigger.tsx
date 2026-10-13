'use client';

import { useLocale, useTranslations } from 'next-intl';
import { FLB_SCHEDULE_AUDIENCES, FLB_SCHEDULE_FREQUENCIES, FLB_STORE_EVENTS } from '@crm/contracts';
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
import { OPERATOR_OPTIONS } from '../forms-channels/workflow';

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
  'group_leave',
  'segment_join',
  'segment_leave',
  'contact_updated',
  'field_match',
  'date_field_match',
  'schedule',
  'shopify_event',
  'woocommerce_event',
];

export function TriggerForm({ data: d, set, setMany, env }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.trigger');
  const th = useTranslations('flb.builder.formsCore.helpers');
  const locale = useLocale();
  const tf = useFlb();
  const { ctx, loading } = env;
  const unofficial = useUnofficialWhatsapp();
  const channel = resolveTriggerChannel(d.channel, env.channels, env.mode);
  const isIg = channel === 'instagram';
  const kind = str(d.kind);
  // A website chat bot starts from the visitor's first message and has no number to send from.
  const isWeb = env.openedAs === 'web';

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
  const kindOpts: Opt[] = (
    isWeb ? ['keyword'] : [...(isIg ? ['comment_to_dm'] : []), ...KIND_OPTIONS]
  ).map((id) => ({
    v: id,
    l: t(`kind.${id}`),
  }));
  const b = (chunks: ReactNode) => <b>{chunks}</b>;
  const segmentOpts: Opt[] = [
    { v: '', l: loading ? t('ext.segmentsLoading') : t('ext.segmentPick') },
    ...ctx.segments.map((sg) => ({ v: sg.id, l: sg.name || t('ext.segmentFallback') })),
  ];
  // Sunday-first short weekday names in the viewer's language (2023-01-01 was a Sunday).
  const weekdayName = (i: number) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2023, 0, 1 + i)),
    );

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

      {kind === 'group_leave' ? (
        <Field label={t('ext.groupLeaveLabel')} hint={t('ext.groupLeaveHint')}>
          <SelectInput value={d.groupId} options={groupOpts} onChange={(v) => set('groupId', v)} />
        </Field>
      ) : null}

      {kind === 'segment_join' || kind === 'segment_leave' ? (
        <>
          <Field
            label={t('ext.segmentLabel')}
            hint={t(kind === 'segment_leave' ? 'ext.segmentLeaveHint' : 'ext.segmentHint')}
          >
            <SelectInput
              value={d.segmentId}
              options={segmentOpts}
              onChange={(v) => set('segmentId', v)}
            />
          </Field>
        </>
      ) : null}

      {kind === 'field_match' || kind === 'date_field_match' ? (
        <Field label={t('ext.fieldLabel')} hint={t('ext.fieldHint')}>
          <TextInput
            value={d.field}
            placeholder={kind === 'date_field_match' ? 'birthday' : 'city'}
            onChange={(v) => set('field', v)}
          />
        </Field>
      ) : null}

      {kind === 'field_match' ? (
        <>
          <Field label={t('ext.test')}>
            <SelectInput
              value={d.operator || 'equals'}
              options={OPERATOR_OPTIONS}
              onChange={(v) => set('operator', v)}
            />
          </Field>
          {d.operator !== 'is_set' && d.operator !== 'is_not_set' ? (
            <Field label={t('ext.value')} hint={t('ext.valueHint')}>
              <TextInput value={d.value} placeholder="Pune" onChange={(v) => set('value', v)} />
            </Field>
          ) : null}
        </>
      ) : null}

      {kind === 'date_field_match' ? (
        <>
          <Field label={t('ext.when')}>
            <SelectInput
              value={d.direction || 'on'}
              options={[
                { v: 'on', l: t('ext.dirOn') },
                { v: 'before', l: t('ext.dirBefore') },
                { v: 'after', l: t('ext.dirAfter') },
              ]}
              onChange={(v) => set('direction', v)}
            />
          </Field>
          {d.direction === 'before' || d.direction === 'after' ? (
            <Field label={t('ext.days')}>
              <TextInput value={d.days} placeholder="3" onChange={(v) => set('days', v)} />
            </Field>
          ) : null}
          <Field label={t('ext.timeOfDay')} hint={t('ext.timeZoneHint')}>
            <TextInput
              value={d.time || '09:00'}
              placeholder="09:00"
              onChange={(v) => set('time', v)}
            />
          </Field>
          <Field label={t('ext.repeat')}>
            <SelectInput
              value={d.yearly === true ? 'yearly' : 'once'}
              options={[
                { v: 'yearly', l: t('ext.yearly') },
                { v: 'once', l: t('ext.fullDate') },
              ]}
              onChange={(v) => set('yearly', v === 'yearly')}
            />
          </Field>
        </>
      ) : null}

      {kind === 'schedule' ? (
        <>
          <Field label={t('ext.repeat')}>
            <SelectInput
              value={d.frequency || 'daily'}
              options={FLB_SCHEDULE_FREQUENCIES.map((f) => ({ v: f, l: t(`ext.frequency.${f}`) }))}
              onChange={(v) => set('frequency', v)}
            />
          </Field>
          {d.frequency === 'once' ? (
            <Field label={t('ext.date')} hint={t('ext.dateHint')}>
              <TextInput value={d.date} placeholder="2026-12-25" onChange={(v) => set('date', v)} />
            </Field>
          ) : null}
          {d.frequency === 'weekly' ? (
            <Field label={t('ext.weekdays')}>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 7 }, (_, i) => {
                  const name = weekdayName(i);
                  const days = asArray(d.weekdays).map(Number);
                  return (
                    <label key={name} className="flex items-center gap-1 text-[12px]">
                      <input
                        type="checkbox"
                        checked={days.includes(i)}
                        onChange={() =>
                          set(
                            'weekdays',
                            days.includes(i) ? days.filter((x) => x !== i) : [...days, i],
                          )
                        }
                      />
                      {name}
                    </label>
                  );
                })}
              </div>
            </Field>
          ) : null}
          {d.frequency === 'monthly' ? (
            <Field label={t('ext.monthDay')} hint={t('ext.monthDayHint')}>
              <TextInput value={d.day} placeholder="1" onChange={(v) => set('day', v)} />
            </Field>
          ) : null}
          <Field label={t('ext.timeOfDay')} hint={t('ext.time24Hint')}>
            <TextInput
              value={d.time || '09:00'}
              placeholder="09:00"
              onChange={(v) => set('time', v)}
            />
          </Field>
          <Field label={t('ext.tz')} hint={t('ext.tzHint')}>
            <TextInput
              value={d.timezone}
              placeholder="Asia/Kolkata"
              onChange={(v) => set('timezone', v)}
            />
          </Field>
          <Field label={t('ext.who')} hint={t('ext.whoHint')}>
            <SelectInput
              value={d.audienceKind || 'all'}
              options={FLB_SCHEDULE_AUDIENCES.map((a) => ({ v: a, l: t(`ext.audience.${a}`) }))}
              onChange={(v) => setMany({ audienceKind: v, audienceRef: '' })}
            />
          </Field>
          {d.audienceKind === 'group' ? (
            <Field label={t('ext.list')}>
              <SelectInput
                value={d.audienceRef}
                options={groupOpts}
                onChange={(v) => set('audienceRef', v)}
              />
            </Field>
          ) : null}
          {d.audienceKind === 'segment' ? (
            <Field label={t('ext.segmentLabel')}>
              <SelectInput
                value={d.audienceRef}
                options={segmentOpts}
                onChange={(v) => set('audienceRef', v)}
              />
            </Field>
          ) : null}
        </>
      ) : null}

      {kind === 'shopify_event' || kind === 'woocommerce_event' ? (
        <>
          <Field label={t('ext.storeEvent')}>
            <SelectInput
              value={d.event || 'checkout_started'}
              options={FLB_STORE_EVENTS.map((e) => ({ v: e, l: t(`ext.storeEvents.${e}`) }))}
              onChange={(v) => set('event', v)}
            />
          </Field>
          {d.event === 'ordered_product' ? (
            <Field label={t('ext.productId')} hint={t('ext.productIdHint')}>
              <TextInput
                value={d.productId}
                placeholder="123456"
                onChange={(v) => set('productId', v)}
              />
            </Field>
          ) : null}
          <Notice>{t('ext.storeNote')}</Notice>
        </>
      ) : null}

      {kind === 'contact_updated' ? <Notice>{t('ext.updatedNote')}</Notice> : null}

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

      {isWeb ? null : (
        <Field label={senderLabel(th, channel, kind)} hint={<LinkedText copy={hint} />}>
          <SelectInput
            value={d.deviceId}
            options={senderOptions(th, channel, senders)}
            onChange={(v) => set('deviceId', v)}
          />
        </Field>
      )}
      {senderMissing && !isWeb ? (
        <Notice tone="danger" className="-mt-2">
          {th(senderPickKey(channel))}
        </Notice>
      ) : null}
      {senderNone && !isWeb ? (
        <Notice tone="warn" className="-mt-2">
          <LinkedText copy={senderNoneCopy(channel, unofficial)} strong />
        </Notice>
      ) : null}
    </>
  );
}
