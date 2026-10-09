'use client';

import { useTranslations } from 'next-intl';
import { Field, SelectInput, TextArea, TextInput } from '../kit';
import type { FormProps } from '../types';
import { agentLabel, str, withCurrent } from './helpers';
import { Link } from './parts';

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

export function AssignForm({ data: d, set, env }: FormProps) {
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
            ? t.rich('teamHint', { link: (chunks) => <Link href="/team-inbox">{chunks}</Link> })
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
          : t.rich('botHintNone', { link: (chunks) => <Link href="/team-inbox">{chunks}</Link> })
      }
    >
      <SelectInput value={d.bot} options={opts} onChange={(v) => set('bot', v)} />
    </Field>
  );
}
