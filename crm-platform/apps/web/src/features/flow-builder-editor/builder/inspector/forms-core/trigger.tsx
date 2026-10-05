'use client';

import { FLOW_TYPE_LABELS } from '@crm/contracts';
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
];

const COMMENT_TO_DM: Opt = { v: 'comment_to_dm', l: 'Instagram: someone comments on a post → DM' };

export function TriggerForm({ data: d, set, setMany, env }: FormProps) {
  const { ctx, loading } = env;
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

  const senders = ctx.senders[channel];
  const senderChosen = str(d.deviceId).trim() !== '';
  const senderMissing = !senderChosen && senders.length > 0;
  const senderNone = !senderChosen && senders.length === 0;
  const hint = senderHint(channel);

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
          <LinkedText copy={senderNoneCopy(channel)} strong />
        </Notice>
      ) : null}
    </>
  );
}
