'use client';

import { Field, SelectInput, TextArea, TextInput } from '../kit';
import type { FormProps } from '../types';
import { agentLabel, str, withCurrent } from './helpers';
import { Link } from './parts';

export function TagForm({ data: d, set, setMany, env }: FormProps) {
  const tags = env.ctx.tags;
  const opts = withCurrent(
    [
      { v: '', l: tags.length ? '— pick existing tag —' : 'No tags yet — type a new name below' },
      ...tags.map((t) => ({ v: t.id, l: t.name })),
    ],
    d.tagId,
    (v) => `(deleted tag ${v.slice(0, 8)})`,
  );
  // Picking mirrors the name into `tag` so the card preview and the runtime stay in sync.
  const pickExisting = (id: string) => {
    const t = tags.find((x) => x.id === id);
    setMany({ tagId: id, tag: t ? t.name : '' });
  };
  return (
    <>
      <Field label="Action">
        <SelectInput
          value={d.action}
          options={[
            { v: 'add', l: 'Add tag to contact' },
            { v: 'remove', l: 'Remove tag from contact' },
          ]}
          onChange={(v) => set('action', v)}
        />
      </Field>
      <Field
        label="Tag"
        hint="Pick from existing tags or type a new name. The contact gets tagged (or untagged) when this node fires."
      >
        <div className="mb-2">
          <SelectInput value={d.tagId} options={opts} onChange={pickExisting} />
        </div>
        <TextInput
          value={d.tag}
          onChange={(v) => setMany({ tag: v, tagId: '' })}
          placeholder="…or type a new tag"
        />
      </Field>
    </>
  );
}

export function AssignForm({ data: d, set, env }: FormProps) {
  const teams = env.ctx.teams;
  const teamOpts = teams.length
    ? withCurrent(
        [
          { v: '', l: '— pick team —' },
          ...teams.map((t) => ({
            v: t.id,
            l: t.name + (t.members.length ? ` · ${t.members.length} agent(s)` : ''),
          })),
        ],
        d.team,
        (v) => `${v} (not in workspace)`,
      )
    : withCurrent(
        [{ v: '', l: 'No teams yet — create one in /team-inbox' }],
        d.team,
        (v) => `${v} (not in workspace)`,
      );
  const selectedTeam = teams.find((t) => t.id === str(d.team));
  const memberOpts = [
    { v: '', l: 'Any (use team strategy)' },
    ...(selectedTeam ? selectedTeam.members.map((m) => ({ v: m.id, l: m.name })) : []),
  ];
  return (
    <>
      <Field
        label="Team"
        hint={
          teams.length ? (
            <>
              Conversation lands in this team&apos;s queue.{' '}
              <Link href="/team-inbox">Manage teams →</Link>
            </>
          ) : undefined
        }
      >
        <SelectInput value={d.team} options={teamOpts} onChange={(v) => set('team', v)} />
      </Field>
      {selectedTeam ? (
        <Field
          label="Assign to specific agent (optional)"
          hint={
            <>
              Leave as <b>Any</b> to use the team&apos;s assignment strategy (round-robin /
              load-balanced / first-online).
            </>
          }
        >
          <SelectInput value={d.userId} options={memberOpts} onChange={(v) => set('userId', v)} />
        </Field>
      ) : null}
      <Field
        label="Note for agent"
        hint="Internal note shown on the conversation when it lands in the team's inbox."
      >
        <TextArea value={d.message} rows={3} onChange={(v) => set('message', v)} />
      </Field>
    </>
  );
}

export function ChatbotForm({ data: d, set, env }: FormProps) {
  const agents = env.ctx.agents;
  const opts = withCurrent(
    [
      { v: '', l: agents.length ? '— pick AI agent —' : 'No agents yet' },
      ...agents.map((a) => ({ v: a.id, l: agentLabel(a) })),
    ],
    d.bot,
    (v) => `Agent ${v.slice(0, 8)} (not in workspace)`,
  );
  return (
    <Field
      label="AI agent to trigger"
      hint={
        agents.length ? (
          'Pick a saved AI agent — its system prompt + model run when this node fires.'
        ) : (
          <>
            You have no AI agents yet. You can also{' '}
            <Link href="/team-inbox">manage agents in /team-inbox</Link>.
          </>
        )
      }
    >
      <SelectInput value={d.bot} options={opts} onChange={(v) => set('bot', v)} />
    </Field>
  );
}
