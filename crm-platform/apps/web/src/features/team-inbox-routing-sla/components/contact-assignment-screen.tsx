'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  Switch,
  useToast,
  Textarea,
} from '@crm/ui';
import {
  ASSIGNMENT_ORIGINS,
  CONTACT_ASSIGNMENT_STRATEGIES,
  type AssignmentRule,
  type AssignmentSubject,
  type TestAssignmentResponse,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { PlanPaywall } from '@/features/plans-subscriptions-trials/components/plan-paywall';
import {
  CA_KEYS,
  contactAssignmentApi,
  useAssignmentRules,
  useAssignmentSettings,
  usePipelineChoices,
} from '../api/contact-assignment';
import { useAssignees } from '../api/routing';
import {
  draftOf,
  emptyDraft,
  toInput,
  usedConditions,
  type AssignmentDraft,
  type DraftProblem,
} from '../lib/contact-assignment-form';

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3">
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} label={label} />
      <span className="text-sm">
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const toggle = (list: string[], id: string, on: boolean) =>
  on ? [...new Set([...list, id])] : list.filter((x) => x !== id);

/**
 * `/contact-assignment` (Settings > Automation > Contact assignment, BL-013): the switch (OFF by default), the priority-ordered rules
 * that give a NEW contact or deal without an owner to a person, and a "test this rule" box. Reading needs `crm.assignment.read`,
 * changing `crm.assignment.manage`; a plan without routing rules gets the paywall. An owner someone set is never replaced; people on
 * leave are skipped (a fixed person by their delegate).
 */
export function ContactAssignmentScreen() {
  const t = useTranslations('team-inbox-routing-sla.contactAssignment');
  const canManage = useCan('crm.assignment.manage');
  const qc = useQueryClient();
  const { toast } = useToast();
  const pathname = usePathname();
  const settingsQ = useAssignmentSettings();
  const rulesQ = useAssignmentRules();
  const assignees = useAssignees(canManage);
  const pipelines = usePipelineChoices();
  const [draft, setDraft] = useState<AssignmentDraft | null>(null);
  const [editing, setEditing] = useState<AssignmentRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<DraftProblem | null>(null);
  const [toDelete, setToDelete] = useState<AssignmentRule | null>(null);
  const [busy, setBusy] = useState(false);

  const rules = rulesQ.data?.data ?? [];
  const locked =
    (rulesQ.error instanceof ApiError && rulesQ.error.code === 'PLAN_FEATURE_LOCKED') ||
    (settingsQ.error instanceof ApiError && settingsQ.error.code === 'PLAN_FEATURE_LOCKED');
  const users = assignees.data?.users ?? [];
  const teams = assignees.data?.teams ?? [];
  const nameOf = (id: string) =>
    users.find((u) => u.id === id)?.name ??
    users.find((u) => u.id === id)?.email ??
    t('unknownPerson');
  const teamName = (id: string) => teams.find((x) => x.id === id)?.name ?? t('unknownTeam');

  const reload = async () => {
    await qc.invalidateQueries({ queryKey: CA_KEYS.rules });
    await qc.invalidateQueries({ queryKey: CA_KEYS.settings });
  };
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.isRowVersionConflict) toast(t('conflict'), 'danger');
    else toast(e instanceof ApiError && e.message ? e.message : t('failed'), 'danger');
  };
  const guard = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await work();
      if (done) toast(done);
    } catch (e) {
      fail(e);
    } finally {
      await reload();
      setBusy(false);
    }
  };

  const form = draft;
  const set = (p: Partial<AssignmentDraft>) => form && setDraft({ ...form, ...p });

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!form) return;
    const parsed = toInput(form);
    if (!parsed.ok) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      if (editing) {
        const { subject: _subject, ...rest } = parsed.value;
        void _subject;
        await contactAssignmentApi.update(editing.id, { rowVersion: editing.rowVersion, ...rest });
        toast(t('saved'));
      } else {
        await contactAssignmentApi.create(parsed.value);
        toast(t('created'));
      }
      setDraft(null);
      setEditing(null);
    } catch (e) {
      fail(e);
    } finally {
      await reload();
      setSaving(false);
    }
  };

  const move = (r: AssignmentRule, dir: -1 | 1) => {
    const same = rules.filter((x) => x.subject === r.subject).map((x) => x.id);
    const i = same.indexOf(r.id);
    const j = i + dir;
    if (j < 0 || j >= same.length) return;
    [same[i], same[j]] = [same[j]!, same[i]!];
    void guard(() => contactAssignmentApi.reorder({ subject: r.subject, ids: same }));
  };

  const summary = (r: AssignmentRule) => {
    const who = [...r.userIds.map(nameOf), ...r.teamIds.map(teamName)].join(', ');
    const conds = usedConditions(r.conditions)
      .map((c) => t(`cond.${c}`))
      .join(', ');
    return `${t(`strategy.${r.strategy}`)}: ${who || '–'} · ${conds || t('catchAll')}`;
  };

  const problemText: Record<DraftProblem, string> = {
    name: t('problems.name'),
    people: t('problems.people'),
    fixedOne: t('problems.fixedOne'),
    prefix: t('problems.prefix'),
    value: t('problems.value'),
  };

  return (
    <section className="mx-auto max-w-4xl space-y-6" data-testid="contact-assignment">
      {locked && (
        <PlanPaywall gates={[{ href: pathname, feature: 'inbox_routing' }]} enabled={[]} />
      )}
      <header className="space-y-2">
        <Link
          href="/settings/automation"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {t('back')}
        </Link>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </header>

      <Alert tone="info">
        <p className="mb-1 font-medium">{t('howTitle')}</p>
        <ol className="list-decimal space-y-0.5 ps-5 text-sm">
          <li>{t('how1')}</li>
          <li>{t('how2')}</li>
          <li>{t('how3')}</li>
          <li>{t('how4')}</li>
        </ol>
      </Alert>

      {!locked && (
        <div className="space-y-3 rounded-lg border border-border p-4" data-testid="ca-settings">
          {settingsQ.isPending ? (
            <Spinner />
          ) : (
            <>
              <Toggle
                label={t('enable')}
                hint={t('enableHint')}
                checked={settingsQ.data?.enabled ?? false}
                disabled={!canManage || busy}
                onChange={(v) =>
                  void guard(
                    () => contactAssignmentApi.saveSettings({ enabled: v }),
                    v ? t('turnedOn') : t('turnedOff'),
                  )
                }
              />
              <Toggle
                label={t('imports')}
                hint={t('importsHint')}
                checked={settingsQ.data?.applyToImports ?? false}
                disabled={!canManage || busy}
                onChange={(v) =>
                  void guard(() => contactAssignmentApi.saveSettings({ applyToImports: v }))
                }
              />
            </>
          )}
        </div>
      )}

      {canManage && !locked && !form && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setEditing(null);
              setDraft(emptyDraft('contact'));
            }}
            data-testid="ca-new-contact"
          >
            {t('newContactRule')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setEditing(null);
              setDraft(emptyDraft('deal'));
            }}
            data-testid="ca-new-deal"
          >
            {t('newDealRule')}
          </Button>
        </div>
      )}

      {canManage && !locked && form && (
        <form
          onSubmit={(e) => void submit(e)}
          className="space-y-3 rounded-lg border border-border p-4"
          data-testid="ca-form"
          noValidate
        >
          <h2 className="text-sm font-medium">
            {editing
              ? t('editTitle')
              : form.subject === 'contact'
                ? t('newContactRule')
                : t('newDealRule')}
          </h2>
          <Field label={t('name')} error={problem === 'name' ? problemText.name : undefined}>
            <Input
              value={form.name}
              maxLength={120}
              onChange={(e) => set({ name: e.target.value })}
              data-testid="ca-name"
            />
          </Field>
          <Field label={t('strategyLabel')}>
            <Select
              value={form.strategy}
              onChange={(e) => set({ strategy: e.target.value as AssignmentDraft['strategy'] })}
              data-testid="ca-strategy"
            >
              {CONTACT_ASSIGNMENT_STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {t(`strategy.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('people')}</legend>
            <p className="text-xs text-muted-foreground">{t('peopleHint')}</p>
            {problem === 'people' || problem === 'fixedOne' ? (
              <p role="alert" className="text-sm text-danger">
                {problemText[problem]}
              </p>
            ) : null}
            <div className="grid gap-1 sm:grid-cols-2">
              {users.map((u) => (
                <Check
                  key={u.id}
                  checked={form.userIds.includes(u.id)}
                  onChange={(on) =>
                    set({
                      userIds:
                        form.strategy === 'fixed'
                          ? on
                            ? [u.id]
                            : []
                          : toggle(form.userIds, u.id, on),
                    })
                  }
                  label={
                    <>
                      {u.name ?? u.email}
                      {u.onLeave ? (
                        <span className="ms-1 text-xs text-warning">{t('onLeave')}</span>
                      ) : null}
                    </>
                  }
                />
              ))}
            </div>
            {form.strategy !== 'fixed' && teams.length > 0 && (
              <div className="grid gap-1 pt-1 sm:grid-cols-2">
                {teams.map((x) => (
                  <Check
                    key={x.id}
                    checked={form.teamIds.includes(x.id)}
                    onChange={(on) => set({ teamIds: toggle(form.teamIds, x.id, on) })}
                    label={t('teamOption', { name: x.name })}
                  />
                ))}
              </div>
            )}
          </fieldset>
          <Toggle
            label={t('skipOffline')}
            hint={t('skipOfflineHint')}
            checked={form.skipOffline}
            onChange={(v) => set({ skipOffline: v })}
          />

          <fieldset className="space-y-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">{t('conditions')}</legend>
            <p className="text-xs text-muted-foreground">{t('conditionsHint')}</p>
            {form.subject === 'contact' ? (
              <>
                <Field label={t('f.sources')} hint={t('f.listHint')}>
                  <Input value={form.sources} onChange={(e) => set({ sources: e.target.value })} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('f.countryCodes')} hint={t('f.listHint')}>
                    <Input
                      value={form.countryCodes}
                      onChange={(e) => set({ countryCodes: e.target.value })}
                    />
                  </Field>
                  <Field
                    label={t('f.phonePrefixes')}
                    hint={t('f.phoneHint')}
                    error={problem === 'prefix' ? problemText.prefix : undefined}
                  >
                    <Input
                      value={form.phonePrefixes}
                      onChange={(e) => set({ phonePrefixes: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label={t('f.lifecycleStages')} hint={t('f.listHint')}>
                  <Input
                    value={form.lifecycleStages}
                    onChange={(e) => set({ lifecycleStages: e.target.value })}
                  />
                </Field>
                <div>
                  <p className="text-sm">{t('f.origins')}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {ASSIGNMENT_ORIGINS.map((o) => (
                      <Check
                        key={o}
                        checked={form.origins.includes(o)}
                        onChange={(on) => set({ origins: toggle(form.origins, o, on) })}
                        label={t(`origin.${o}`)}
                      />
                    ))}
                  </div>
                </div>
                <Field label={t('f.properties')} hint={t('f.propertiesHint')}>
                  <Textarea
                    rows={3}
                    value={form.properties}
                    onChange={(e) => set({ properties: e.target.value })}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label={t('f.sources')} hint={t('f.listHint')}>
                  <Input value={form.sources} onChange={(e) => set({ sources: e.target.value })} />
                </Field>
                <div>
                  <p className="text-sm">{t('f.pipelines')}</p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {(pipelines.data ?? []).map((p) => (
                      <Check
                        key={p.id}
                        checked={form.pipelineIds.includes(p.id)}
                        onChange={(on) => set({ pipelineIds: toggle(form.pipelineIds, p.id, on) })}
                        label={p.name}
                      />
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={t('f.valueMin')}
                    error={problem === 'value' ? problemText.value : undefined}
                  >
                    <Input
                      inputMode="decimal"
                      value={form.valueMin}
                      onChange={(e) => set({ valueMin: e.target.value })}
                    />
                  </Field>
                  <Field label={t('f.valueMax')}>
                    <Input
                      inputMode="decimal"
                      value={form.valueMax}
                      onChange={(e) => set({ valueMax: e.target.value })}
                    />
                  </Field>
                </div>
              </>
            )}
          </fieldset>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(null);
                setEditing(null);
                setProblem(null);
              }}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />}
              {t('save')}
            </Button>
          </div>
        </form>
      )}

      {!locked &&
        (['contact', 'deal'] as const).map((subject) => (
          <RuleList
            key={subject}
            subject={subject}
            rules={rules.filter((r) => r.subject === subject)}
            loading={rulesQ.isPending}
            canManage={canManage}
            busy={busy}
            summary={summary}
            onToggle={(r) =>
              void guard(() =>
                contactAssignmentApi.update(r.id, {
                  rowVersion: r.rowVersion,
                  isActive: !r.isActive,
                }),
              )
            }
            onMove={move}
            onEdit={(r) => {
              setEditing(r);
              setDraft(draftOf(r));
              setProblem(null);
            }}
            onDelete={setToDelete}
          />
        ))}

      {!locked && <TestBox />}

      <ConfirmDialog
        open={toDelete !== null}
        title={t('deleteTitle')}
        message={t('deleteMessage', { name: toDelete?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => {
          const r = toDelete;
          setToDelete(null);
          if (r) void guard(() => contactAssignmentApi.remove(r.id), t('deleted'));
        }}
        onClose={() => setToDelete(null)}
      />
    </section>
  );
}

function RuleList({
  subject,
  rules,
  loading,
  canManage,
  busy,
  summary,
  onToggle,
  onMove,
  onEdit,
  onDelete,
}: {
  subject: AssignmentSubject;
  rules: AssignmentRule[];
  loading: boolean;
  canManage: boolean;
  busy: boolean;
  summary: (r: AssignmentRule) => string;
  onToggle: (r: AssignmentRule) => void;
  onMove: (r: AssignmentRule, dir: -1 | 1) => void;
  onEdit: (r: AssignmentRule) => void;
  onDelete: (r: AssignmentRule) => void;
}) {
  const t = useTranslations('team-inbox-routing-sla.contactAssignment');
  return (
    <div className="space-y-2" data-testid={`ca-list-${subject}`}>
      <h2 className="text-sm font-medium">
        {subject === 'contact' ? t('contactRules') : t('dealRules')}
      </h2>
      {loading ? (
        <Spinner />
      ) : rules.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          message={subject === 'contact' ? t('emptyContacts') : t('emptyDeals')}
        />
      ) : (
        <ol className="space-y-2">
          {rules.map((r, i) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
              data-testid={`ca-rule-${r.id}`}
            >
              <span className="grid size-6 place-items-center rounded-full bg-muted text-xs">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {r.name}
                  {!r.isActive && <Badge>{t('off')}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">{summary(r)}</div>
                <div className="text-xs text-muted-foreground">
                  {t('fired', { count: r.firedCount })}
                </div>
              </div>
              {canManage && (
                <div className="flex items-center gap-1">
                  <Switch
                    checked={r.isActive}
                    disabled={busy}
                    onCheckedChange={() => onToggle(r)}
                    label={t('activeFor', { name: r.name })}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || i === 0}
                    onClick={() => onMove(r, -1)}
                    aria-label={t('moveUp', { name: r.name })}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || i === rules.length - 1}
                    onClick={() => onMove(r, 1)}
                    aria-label={t('moveDown', { name: r.name })}
                  >
                    ↓
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => onEdit(r)}>
                    {t('edit')}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDelete(r)}>
                    {t('delete')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** "Test this rule": describe a contact or deal and see which rule would take it and who, without changing anything. */
function TestBox() {
  const t = useTranslations('team-inbox-routing-sla.contactAssignment');
  const [subject, setSubject] = useState<AssignmentSubject>('contact');
  const [source, setSource] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [stage, setStage] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestAssignmentResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const run = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setResult(
        await contactAssignmentApi.test({
          subject,
          facts: {
            source: source.trim() || null,
            phone: phone.trim() || null,
            countryCode: country.trim() || null,
            lifecycleStage: stage.trim() || null,
            value: value.trim() === '' || Number.isNaN(Number(value)) ? null : Number(value),
          },
        }),
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-4" data-testid="ca-test">
      <h2 className="text-sm font-medium">{t('testTitle')}</h2>
      <p className="text-xs text-muted-foreground">{t('testHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('testSubject')}>
          <Select value={subject} onChange={(e) => setSubject(e.target.value as AssignmentSubject)}>
            <option value="contact">{t('subjectContact')}</option>
            <option value="deal">{t('subjectDeal')}</option>
          </Select>
        </Field>
        <Field label={t('f.sources')}>
          <Input value={source} onChange={(e) => setSource(e.target.value)} />
        </Field>
        {subject === 'contact' ? (
          <>
            <Field label={t('testPhone')}>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label={t('f.countryCodes')}>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} />
            </Field>
            <Field label={t('f.lifecycleStages')}>
              <Input value={stage} onChange={(e) => setStage(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label={t('testValue')}>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        )}
      </div>
      <Button disabled={busy} onClick={() => void run()}>
        {busy && <Spinner />}
        {t('testRun')}
      </Button>
      {failed && <Alert tone="danger">{t('failed')}</Alert>}
      {result && (
        <Alert
          tone={result.outcome === 'would_assign' ? 'success' : 'warning'}
          data-testid="ca-test-result"
        >
          {result.outcome === 'would_assign' && result.rule && result.owner
            ? t('testWould', { rule: result.rule.name, name: result.owner.name })
            : t(`testOutcome.${result.outcome}`)}
          {result.skipped.length > 0 && (
            <span className="block text-xs">
              {t('testSkipped', { names: result.skipped.map((s) => s.name).join(', ') })}
            </span>
          )}
          {!result.enabled && <span className="block text-xs">{t('testOff')}</span>}
        </Alert>
      )}
    </div>
  );
}
