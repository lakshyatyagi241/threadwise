'use client';

import { useTranslations } from 'next-intl';
import { usePlanFeature } from '@/lib/plan-features';
import {
  destinationOf,
  HANDOFF_DESTINATIONS,
  HANDOFF_MESSAGE_MAX,
  HANDOFF_NOTE_MAX,
  HANDOFF_RETURN_MAX,
  HANDOFF_PRIORITY_CHOICES,
  HANDOFF_REASON_CHOICES,
  isHandoffNode,
  peopleOf,
  returnMessageHasNoExit,
  upgradeLegacy,
} from '../../../lib/handoff-node';
import { Field, SelectInput, TextArea, TextInput } from '../kit';
import type { FormProps } from '../types';
import { agentLabel, str, withCurrent } from './helpers';
import { Link } from './parts';
import { AddonLockLink } from '@/features/plans-subscriptions-trials/components/addon-lock';

export function TagForm({ data: d, set, setMany, env }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.contact');
  const tags = env.ctx.tags;
  const opts = withCurrent(
    [
      { v: '', l: tags.length ? t('tagPick') : t('tagNone') },
      ...tags.map((tag) => ({ v: tag.id, l: tag.name })),
    ],
    d.tagId,
    (v) => t('tagDeleted', { id: v.slice(0, 8) }),
  );
  // Picking mirrors the name into `tag` so the card preview and the runtime stay in sync.
  const pickExisting = (id: string) => {
    const hit = tags.find((x) => x.id === id);
    setMany({ tagId: id, tag: hit ? hit.name : '' });
  };
  return (
    <>
      <Field label={t('actionLabel')}>
        <SelectInput
          value={d.action}
          options={[
            { v: 'add', l: t('actionAdd') },
            { v: 'remove', l: t('actionRemove') },
          ]}
          onChange={(v) => set('action', v)}
        />
      </Field>
      <Field label={t('tagLabel')} hint={t('tagHint')}>
        <div className="mb-2">
          <SelectInput value={d.tagId} options={opts} onChange={pickExisting} />
        </div>
        <TextInput
          value={d.tag}
          onChange={(v) => setMany({ tag: v, tagId: '' })}
          placeholder={t('tagNewPlaceholder')}
        />
      </Field>
    </>
  );
}

export function AssignForm(props: FormProps) {
  const t = useTranslations('flb.builder.handoff');
  const { data: d, setMany } = props;
  if (isHandoffNode(d)) return <HandoffForm {...props} />;
  return (
    <>
      <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-[11.5px]">
        <p className="font-semibold">{t('legacy')}</p>
        <p className="mt-1 text-muted-foreground">{t('upgradeHint')}</p>
        <button
          type="button"
          data-testid="flb-handoff-upgrade"
          onClick={() => setMany(upgradeLegacy(d))}
          className="mt-2 rounded-md bg-brand px-3 py-1.5 text-[11.5px] font-semibold text-brand-foreground hover:opacity-90"
        >
          {t('upgrade')}
        </button>
      </div>
      <LegacyAssignForm {...props} />
    </>
  );
}

function HandoffForm({ node, data: d, set, setMany, env }: FormProps) {
  const t = useTranslations('flb.builder.handoff');
  const returnedWired = (env.edges ?? []).some(
    (e) => e.source === node.id && e.sourceHandle === 'returned',
  );
  const teams = env.ctx.teams;
  const rulesInPlan = usePlanFeature('inbox_routing');
  const kind = destinationOf(d);
  const notInWorkspace = (v: string) => t('unknownMember', { value: v });
  const teamOpts = withCurrent(
    [
      { v: '', l: teams.length ? t('teamPick') : t('teamNone') },
      ...teams.map((team) => ({
        v: team.id,
        l: team.members.length
          ? t('teamOption', { name: team.name, count: team.members.length })
          : team.name,
      })),
    ],
    d.team,
    notInWorkspace,
  );
  const people = peopleOf(teams);
  const personOpts = withCurrent(
    [{ v: '', l: t('personPick') }, ...people.map((m) => ({ v: m.id, l: m.name }))],
    d.userId,
    notInWorkspace,
  );
  const reasonOpts = HANDOFF_REASON_CHOICES.map((r) => ({ v: r, l: t(`reasons.${r}`) }));
  const priorityOpts = HANDOFF_PRIORITY_CHOICES.map((p) => ({
    v: p,
    l: p === '' ? t('priorityKeep') : t(`priorities.${p}`),
  }));
  return (
    <>
      <Field label={t('destination')} hint={t(`destHint.${kind}`)}>
        <SelectInput
          value={kind}
          options={HANDOFF_DESTINATIONS.map((k) => ({
            v: k,
            l: k === 'rules' && !rulesInPlan ? t('dest.rulesLocked') : t(`dest.${k}`),
          }))}
          onChange={(v) => set('destination', v)}
        />
      </Field>
      {kind === 'rules' && !rulesInPlan && (
        <p
          role="note"
          data-testid="flb-handoff-plan-lock"
          className="-mt-2 mb-4 rounded-lg bg-warning/10 p-2.5 text-[11px]"
        >
          {t('lockHint')} <AddonLockLink />
        </p>
      )}
      {kind === 'team' && (
        <Field
          label={t('team')}
          hint={t.rich('teamHint', { link: (chunks) => <Link href="/teams">{chunks}</Link> })}
        >
          <SelectInput
            value={d.team}
            options={teamOpts}
            onChange={(v) => setMany({ team: v, userId: '' })}
          />
        </Field>
      )}
      {kind === 'person' && (
        <Field label={t('person')} hint={t('personHint')}>
          <SelectInput
            value={d.userId}
            options={personOpts}
            onChange={(v) => {
              const owner = teams.find((tm) => tm.members.some((m) => m.id === v));
              setMany({ userId: v, team: owner?.id ?? str(d.team) });
            }}
          />
        </Field>
      )}
      <Field label={t('reason')}>
        <SelectInput value={d.reason} options={reasonOpts} onChange={(v) => set('reason', v)} />
      </Field>
      <Field label={t('priority')}>
        <SelectInput
          value={d.priority}
          options={priorityOpts}
          onChange={(v) => set('priority', v)}
        />
      </Field>
      <Field label={t('note')} hint={t('noteHint')}>
        <TextArea
          value={d.message}
          rows={3}
          maxLength={HANDOFF_NOTE_MAX}
          onChange={(v) => set('message', v)}
        />
      </Field>
      <Field label={t('customerMessage')} hint={t('customerHint')}>
        <TextArea
          value={d.customerMessage}
          rows={3}
          maxLength={HANDOFF_MESSAGE_MAX}
          onChange={(v) => set('customerMessage', v)}
        />
      </Field>
      <Field label={t('offHours')} hint={t('offHoursHint')}>
        <TextArea
          value={d.offHoursMessage}
          rows={3}
          maxLength={HANDOFF_MESSAGE_MAX}
          onChange={(v) => set('offHoursMessage', v)}
        />
      </Field>
      <Field label={t('returnMessage')} hint={t('returnMessageHint')}>
        <TextArea
          value={d.returnMessage}
          rows={3}
          maxLength={HANDOFF_RETURN_MAX}
          onChange={(v) => set('returnMessage', v)}
        />
      </Field>
      {returnMessageHasNoExit(d, returnedWired) && (
        <p
          role="note"
          data-testid="flb-handoff-return-no-exit"
          className="-mt-2 mb-4 rounded-lg bg-warning/10 p-2.5 text-[11px]"
        >
          {t('returnNeedsExit')}
        </p>
      )}
      <div
        className="mb-4 rounded-lg border border-border p-3 text-[11px]"
        data-testid="flb-handoff-exits"
      >
        <p className="font-semibold">{t('exits')}</p>
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          <li>{t('exitAssigned')}</li>
          <li>{t('exitWaiting')}</li>
          <li>{t('exitUnavailable')}</li>
          <li>{t('exitReturned')}</li>
        </ul>
      </div>
    </>
  );
}

function LegacyAssignForm({ data: d, set, env }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.contact');
  const teams = env.ctx.teams;
  const notInWorkspace = (v: string) => t('notInWorkspace', { value: v });
  const teamOpts = teams.length
    ? withCurrent(
        [
          { v: '', l: t('teamPick') },
          ...teams.map((team) => ({
            v: team.id,
            l: team.members.length
              ? t('teamWithAgents', { name: team.name, count: team.members.length })
              : team.name,
          })),
        ],
        d.team,
        notInWorkspace,
      )
    : withCurrent([{ v: '', l: t('teamNone') }], d.team, notInWorkspace);
  const selectedTeam = teams.find((team) => team.id === str(d.team));
  const memberOpts = [
    { v: '', l: t('agentAny') },
    ...(selectedTeam ? selectedTeam.members.map((m) => ({ v: m.id, l: m.name })) : []),
  ];
  return (
    <>
      <Field
        label={t('teamLabel')}
        hint={
          teams.length
            ? t.rich('teamHint', { link: (chunks) => <Link href="/inbox">{chunks}</Link> })
            : undefined
        }
      >
        <SelectInput value={d.team} options={teamOpts} onChange={(v) => set('team', v)} />
      </Field>
      {selectedTeam ? (
        <Field
          label={t('agentLabel')}
          hint={t.rich('agentHint', { b: (chunks) => <b>{chunks}</b> })}
        >
          <SelectInput value={d.userId} options={memberOpts} onChange={(v) => set('userId', v)} />
        </Field>
      ) : null}
      <Field label={t('noteLabel')} hint={t('noteHint')}>
        <TextArea value={d.message} rows={3} onChange={(v) => set('message', v)} />
      </Field>
    </>
  );
}

export function ChatbotForm({ data: d, set, env }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.contact');
  const th = useTranslations('flb.builder.formsCore.helpers');
  const agents = env.ctx.agents;
  const opts = withCurrent(
    [
      { v: '', l: agents.length ? t('botPick') : t('botNone') },
      ...agents.map((a) => ({ v: a.id, l: agentLabel(th, a) })),
    ],
    d.bot,
    (v) => t('botNotInWorkspace', { id: v.slice(0, 8) }),
  );
  return (
    <Field
      label={t('botLabel')}
      hint={
        agents.length
          ? t('botHint')
          : t.rich('botHintNone', { link: (chunks) => <Link href="/inbox">{chunks}</Link> })
      }
    >
      <SelectInput value={d.bot} options={opts} onChange={(v) => set('bot', v)} />
    </Field>
  );
}
