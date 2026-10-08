'use client';

import {
  FLB_SCHEDULE_AUDIENCES,
  FLB_SCHEDULE_FREQUENCIES,
  FLB_STORE_EVENTS,
  FLOW_TYPE_LABELS,
} from '@crm/contracts';
import { offerSenders } from '@/lib/unofficial-whatsapp';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import { Field, Notice, SelectInput, TextInput, type Opt } from '../kit';
import type { FormProps } from '../types';
import {
  asArray,
  resolveTriggerChannel,
  senderHint,
  senderLabel,
  senderNoneCopy,
  senderOptions,
  senderPickNoun,
  str,
  toggleId,
} from './helpers';
import { Link, LinkedText } from './parts';
import { OPERATOR_OPTIONS } from '../forms-channels/workflow';

const KIND_OPTIONS: Opt[] = [
  { v: 'keyword', l: 'Keyword match (customer messages us)' },
  { v: 'tag_added', l: 'Audience: when a tag is added' },
  { v: 'group_join', l: 'Audience: when contact joins a group' },
  { v: 'contact_created', l: 'Audience: when a new contact is added' },
  { v: 'opt_in', l: 'Audience: when a contact re-subscribes' },
  { v: 'order_placed', l: 'Commerce: when an order is placed' },
  { v: 'deal_stage_changed', l: 'Sales: when a deal enters a stage' },
  { v: 'away', l: 'Availability: while Away mode is on' },
  { v: 'out_of_hours', l: 'Availability: outside business hours' },
  { v: 'manual_enroll', l: 'Manual: operator enrolls contacts' },
  { v: 'group_leave', l: 'Audience: when contact leaves a list' },
  { v: 'segment_join', l: 'Audience: when contact enters a segment' },
  { v: 'contact_updated', l: 'Audience: when a contact is updated' },
  { v: 'field_match', l: 'Audience: when a contact field matches a value' },
  { v: 'date_field_match', l: 'Schedule: relative to a date on the contact (birthday…)' },
  { v: 'schedule', l: 'Schedule: at a date and time' },
  { v: 'shopify_event', l: 'Commerce: a Shopify store event' },
  { v: 'woocommerce_event', l: 'Commerce: a WooCommerce store event' },
];

const STORE_EVENT_LABELS: Record<(typeof FLB_STORE_EVENTS)[number], string> = {
  checkout_started: 'Checkout started',
  abandoned_cart: 'Abandoned cart (first reminder is due)',
  order_fulfilled: 'Order fulfilled',
  order_refunded: 'Order refunded',
  order_cancelled: 'Order cancelled',
  ordered_product: 'A product was ordered',
};
const FREQUENCY_LABELS: Record<(typeof FLB_SCHEDULE_FREQUENCIES)[number], string> = {
  once: 'Once, on a date',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};
const AUDIENCE_LABELS: Record<(typeof FLB_SCHEDULE_AUDIENCES)[number], string> = {
  all: 'Every contact with a number',
  group: 'Contacts in a list',
  segment: 'Contacts in a segment',
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const COMMENT_TO_DM: Opt = { v: 'comment_to_dm', l: 'Instagram: someone comments on a post → DM' };

export function TriggerForm({ data: d, set, setMany, env }: FormProps) {
  const { ctx, loading } = env;
  const unofficial = useUnofficialWhatsapp();
  const channel = resolveTriggerChannel(d.channel, env.channels, env.mode);
  const isIg = channel === 'instagram';
  const kind = str(d.kind);

  const tagOpts: Opt[] = [
    { v: '', l: loading ? 'Loading tags…' : '— pick tag —' },
    ...ctx.tags.map((t) => ({ v: t.id, l: t.name || 'Tag' })),
  ];
  const groupOpts: Opt[] = [
    { v: '', l: loading ? 'Loading groups…' : '— pick group —' },
    ...ctx.groups.map((g) => ({ v: g.id, l: g.name || 'Group' })),
  ];
  const stageOpts: Opt[] = [
    { v: '', l: loading ? 'Loading stages…' : '— pick stage —' },
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
    .map((c) => ({ v: c, l: FLOW_TYPE_LABELS[c] }));

  const selectedRules = asArray(d.keywordRuleIds).map(String);

  return (
    <>
      {showChannel ? (
        <Field
          label="Channel"
          hint="Switching channel re-filters the node palette and clears the sender below — a WhatsApp number is not a valid Instagram account or Facebook Page."
        >
          <SelectInput
            value={channel}
            options={channelOpts}
            onChange={(v) => setMany({ channel: v, deviceId: '' })}
          />
        </Field>
      ) : null}

      <Field label="How does this flow start?">
        <SelectInput
          value={kind}
          options={isIg ? [COMMENT_TO_DM, ...KIND_OPTIONS] : KIND_OPTIONS}
          onChange={(v) => set('kind', v)}
        />
      </Field>

      {kind === 'keyword' ? (
        <Field
          label="When to run"
          hint={
            d.keywordMode === 'any'
              ? 'Runs ONLY when no keyword flow matches. Keyword flows always win.'
              : 'Pick "any message" for a catch-all fallback flow.'
          }
        >
          <SelectInput
            value={d.keywordMode}
            options={[
              { v: 'keywords', l: 'On specific keywords' },
              { v: 'any', l: 'On any message (default route)' },
            ]}
            onChange={(v) => set('keywordMode', v)}
          />
        </Field>
      ) : null}

      {kind === 'keyword' && d.keywordMode !== 'any' ? (
        <Field label="Keywords" hint="Comma-separated. Match is fuzzy.">
          <TextInput
            value={d.keywords}
            placeholder="price, pricing, cost"
            onChange={(v) => set('keywords', v)}
          />
        </Field>
      ) : null}

      {kind === 'tag_added' ? (
        <Field
          label="Tag that triggers enrollment"
          hint="Every contact who gets this tag is auto-enrolled into this flow. Tag is added from /team-inbox or routing rules."
        >
          <SelectInput value={d.tagId} options={tagOpts} onChange={(v) => set('tagId', v)} />
        </Field>
      ) : null}

      {kind === 'group_join' ? (
        <Field
          label="Group that triggers enrollment"
          hint="Every contact added to this group is auto-enrolled."
        >
          <SelectInput value={d.groupId} options={groupOpts} onChange={(v) => set('groupId', v)} />
        </Field>
      ) : null}

      {kind === 'deal_stage_changed' ? (
        <Field
          label="Stage that triggers the flow"
          hint="When a deal is moved INTO this pipeline stage, its linked contact is enrolled. Manage stages on the /deals board."
        >
          <SelectInput value={d.stageId} options={stageOpts} onChange={(v) => set('stageId', v)} />
        </Field>
      ) : null}

      {kind === 'group_leave' ? (
        <Field
          label="List that triggers the flow"
          hint="Runs when a contact is taken out of this list by a person or an import. A flow that removes them itself does not start it."
        >
          <SelectInput value={d.groupId} options={groupOpts} onChange={(v) => set('groupId', v)} />
        </Field>
      ) : null}

      {kind === 'segment_join' ? (
        <>
          <Field
            label="Segment"
            hint="Runs once per contact, the first time they are found inside the segment after being created, tagged, listed or updated."
          >
            <SelectInput
              value={d.segmentId}
              options={[
                { v: '', l: loading ? 'Loading segments…' : '— pick segment —' },
                ...ctx.segments.map((s) => ({ v: s.id, l: s.name || 'Segment' })),
              ]}
              onChange={(v) => set('segmentId', v)}
            />
          </Field>
        </>
      ) : null}

      {kind === 'field_match' || kind === 'date_field_match' ? (
        <Field
          label="Contact field"
          hint="The field key: name, email, title, language, address, or a custom field's key."
        >
          <TextInput
            value={d.field}
            placeholder={kind === 'date_field_match' ? 'birthday' : 'city'}
            onChange={(v) => set('field', v)}
          />
        </Field>
      ) : null}

      {kind === 'field_match' ? (
        <>
          <Field label="Test">
            <SelectInput
              value={d.operator || 'equals'}
              options={OPERATOR_OPTIONS}
              onChange={(v) => set('operator', v)}
            />
          </Field>
          {d.operator !== 'is_set' && d.operator !== 'is_not_set' ? (
            <Field
              label="Value"
              hint="Checked each time the contact is created or changed. A contact runs once for each value it takes."
            >
              <TextInput value={d.value} placeholder="Pune" onChange={(v) => set('value', v)} />
            </Field>
          ) : null}
        </>
      ) : null}

      {kind === 'date_field_match' ? (
        <>
          <Field label="When">
            <SelectInput
              value={d.direction || 'on'}
              options={[
                { v: 'on', l: 'On the date' },
                { v: 'before', l: 'Days before the date' },
                { v: 'after', l: 'Days after the date' },
              ]}
              onChange={(v) => set('direction', v)}
            />
          </Field>
          {d.direction === 'before' || d.direction === 'after' ? (
            <Field label="Days">
              <TextInput value={d.days} placeholder="3" onChange={(v) => set('days', v)} />
            </Field>
          ) : null}
          <Field label="Time of day" hint="In your workspace's time zone. Checked once a day.">
            <TextInput
              value={d.time || '09:00'}
              placeholder="09:00"
              onChange={(v) => set('time', v)}
            />
          </Field>
          <Field label="Repeat">
            <SelectInput
              value={d.yearly === true ? 'yearly' : 'once'}
              options={[
                { v: 'yearly', l: 'Every year (month and day only)' },
                { v: 'once', l: 'Only on the full date' },
              ]}
              onChange={(v) => set('yearly', v === 'yearly')}
            />
          </Field>
        </>
      ) : null}

      {kind === 'schedule' ? (
        <>
          <Field label="Repeat">
            <SelectInput
              value={d.frequency || 'daily'}
              options={FLB_SCHEDULE_FREQUENCIES.map((f) => ({ v: f, l: FREQUENCY_LABELS[f] }))}
              onChange={(v) => set('frequency', v)}
            />
          </Field>
          {d.frequency === 'once' ? (
            <Field label="Date" hint="YYYY-MM-DD.">
              <TextInput value={d.date} placeholder="2026-12-25" onChange={(v) => set('date', v)} />
            </Field>
          ) : null}
          {d.frequency === 'weekly' ? (
            <Field label="Days of the week">
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((name, i) => {
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
            <Field label="Day of the month" hint="31 means the last day of a shorter month.">
              <TextInput value={d.day} placeholder="1" onChange={(v) => set('day', v)} />
            </Field>
          ) : null}
          <Field label="Time of day" hint="HH:MM, 24-hour.">
            <TextInput
              value={d.time || '09:00'}
              placeholder="09:00"
              onChange={(v) => set('time', v)}
            />
          </Field>
          <Field
            label="Time zone (optional)"
            hint="An IANA name such as Asia/Kolkata. Blank uses your workspace's time zone."
          >
            <TextInput
              value={d.timezone}
              placeholder="Asia/Kolkata"
              onChange={(v) => set('timezone', v)}
            />
          </Field>
          <Field
            label="Who"
            hint="At most 5,000 people per run. Contacts who opted out, are archived or have no number are left out."
          >
            <SelectInput
              value={d.audienceKind || 'all'}
              options={FLB_SCHEDULE_AUDIENCES.map((a) => ({ v: a, l: AUDIENCE_LABELS[a] }))}
              onChange={(v) => setMany({ audienceKind: v, audienceRef: '' })}
            />
          </Field>
          {d.audienceKind === 'group' ? (
            <Field label="List">
              <SelectInput
                value={d.audienceRef}
                options={groupOpts}
                onChange={(v) => set('audienceRef', v)}
              />
            </Field>
          ) : null}
          {d.audienceKind === 'segment' ? (
            <Field label="Segment">
              <SelectInput
                value={d.audienceRef}
                options={[
                  { v: '', l: loading ? 'Loading segments…' : '— pick segment —' },
                  ...ctx.segments.map((s) => ({ v: s.id, l: s.name || 'Segment' })),
                ]}
                onChange={(v) => set('audienceRef', v)}
              />
            </Field>
          ) : null}
        </>
      ) : null}

      {kind === 'shopify_event' || kind === 'woocommerce_event' ? (
        <>
          <Field label="Store event">
            <SelectInput
              value={d.event || 'checkout_started'}
              options={FLB_STORE_EVENTS.map((e) => ({ v: e, l: STORE_EVENT_LABELS[e] }))}
              onChange={(v) => set('event', v)}
            />
          </Field>
          {d.event === 'ordered_product' ? (
            <Field label="Product id (optional)" hint="Blank = any product in the order.">
              <TextInput
                value={d.productId}
                placeholder="123456"
                onChange={(v) => set('productId', v)}
              />
            </Field>
          ) : null}
          <Notice>
            The customer is matched to a saved contact by phone number; nobody is created for an
            order. &ldquo;Added to cart&rdquo; and &ldquo;product viewed&rdquo; are not offered: the
            store does not report them.
          </Notice>
        </>
      ) : null}

      {kind === 'contact_updated' ? (
        <Notice>
          Fires when a person or an import changes a contact, each time. A change made by another
          flow does not start it.
        </Notice>
      ) : null}

      {kind === 'comment_to_dm' ? (
        <Field
          label="Bind to comment keyword rules"
          hint="Tick the rules that should launch this flow. Leave all unticked to run on any Comment → DM rule."
        >
          {ctx.keywordRules.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-snug text-amber-800">
              No Comment → DM keyword rules yet. Create them on{' '}
              <Link href="/auto-reply" strong>
                /auto-reply
              </Link>{' '}
              (Instagram · trigger &quot;Comment → DM&quot;), then pick them here.
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
                  <span className="flex-1 truncate">{r.keyword || `Rule ${r.id.slice(0, 8)}`}</span>
                  {!r.active ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[9.5px] text-muted-foreground">
                      off
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          )}
        </Field>
      ) : null}

      {kind === 'order_placed' ? (
        <Notice>
          Fires for every new order. The order&apos;s customer is matched to a saved contact and
          enrolled.
        </Notice>
      ) : null}
      {kind === 'contact_created' || kind === 'opt_in' ? (
        <Notice>Fires automatically — no extra config needed.</Notice>
      ) : null}
      {kind === 'away' ? (
        <Notice>
          Fires on any incoming message while <b>Away mode</b> is ON. Toggle Away mode from the{' '}
          <Link href="/auto-reply">Auto Reply</Link> page. Each contact is enrolled once.
        </Notice>
      ) : null}
      {kind === 'out_of_hours' ? (
        <Notice>
          Fires on any incoming message that arrives <b>outside your workspace Business Hours</b>.
          Set Business Hours in your workspace settings. Each contact is enrolled once.
        </Notice>
      ) : null}
      {kind === 'manual_enroll' ? (
        <Notice>
          You&apos;ll enroll contacts manually from the <Link href="/flows">/flows list</Link> via
          the <b>Enroll</b> button next to this flow.
        </Notice>
      ) : null}

      <Field label={senderLabel(channel, kind)} hint={<LinkedText copy={hint} />}>
        <SelectInput
          value={d.deviceId}
          options={senderOptions(channel, senders)}
          onChange={(v) => set('deviceId', v)}
        />
      </Field>
      {senderMissing ? (
        <Notice tone="danger" className="-mt-2">
          Pick {senderPickNoun(channel)} before saving — without one the flow has no channel to run
          on.
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
