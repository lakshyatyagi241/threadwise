'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  CHANNEL_KINDS,
  ROUTING_DESCRIPTION_MAX,
  ROUTING_NAME_MAX,
  type RoutingRule,
  type RoutingStrategy,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Spinner,
  Switch,
  Textarea,
  useToast,
} from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { PlanPaywall } from '@/features/plans-subscriptions-trials/components/plan-paywall';
import { useSegmentCatalog } from '@/features/segments/api/lookups';
import { refresh, routingApi, useAssignees, useRule } from '../api/routing';
import {
  editableOf,
  emptyForm,
  formFromRule,
  payloadFromForm,
  problemsOf,
  toggleId,
  type FormProblem,
  type RuleForm,
} from '../lib/form';
import { ContactConditions } from './contact-conditions';

const STRATEGIES: readonly RoutingStrategy[] = ['round_robin', 'least_busy', 'specific'];

const isCode = (e: unknown, code: string) => e instanceof ApiError && e.code === code;
const reason = (e: unknown, fallback: string) =>
  e instanceof ApiError && e.message ? e.message : fallback;

/** `/auto-assignment/new` and `/auto-assignment/:id`: one rule, as a form. Without an `id` it is a new rule. */
export function RuleFormScreen({ id }: { id?: string }) {
  const t = useTranslations('team-inbox-routing-sla.form');
  const canManage = useCan('inbox.routing.manage');
  const pathname = usePathname();
  const rule = useRule(id ?? null);

  const back = (
    <Link href="/auto-assignment" className="text-sm text-muted-foreground hover:text-foreground">
      ← {t('back')}
    </Link>
  );

  if (!canManage) {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        {back}
        <Alert tone="warning">{t('noAccess')}</Alert>
      </section>
    );
  }
  if (id && rule.isPending) {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        {back}
        <div className="flex justify-center p-10" role="status" aria-label={t('loading')}>
          <Spinner />
        </div>
      </section>
    );
  }
  if (id && rule.isError) {
    const locked = isCode(rule.error, 'PLAN_FEATURE_LOCKED');
    const missing = rule.error instanceof ApiError && rule.error.status === 404;
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        {locked && (
          <PlanPaywall gates={[{ href: pathname, feature: 'inbox_routing' }]} enabled={[]} />
        )}
        {back}
        <Alert tone="danger">{missing ? t('notFound') : t('loadFailed')}</Alert>
      </section>
    );
  }
  return (
    <section className="mx-auto max-w-3xl space-y-6">
      {back}
      <RuleFormBody key={rule.data?.id ?? 'new'} rule={rule.data} />
    </section>
  );
}

export function RuleFormBody({ rule }: { rule?: RoutingRule }) {
  const t = useTranslations('team-inbox-routing-sla.form');
  const ts = useTranslations('team-inbox-routing-sla.rules.strategy');
  const tc = useTranslations('team-inbox-routing-sla.channels');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const uid = useId();
  const lookups = useSegmentCatalog();
  const assignees = useAssignees();
  const [form, setForm] = useState<RuleForm>(() => (rule ? formFromRule(rule) : emptyForm()));
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState<'save' | 'activate' | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const pathname = usePathname();

  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const problems = problemsOf(form, lookups.catalog);
  const has = (p: FormProblem) => showProblems && problems.includes(p);

  async function submit(activate: boolean) {
    if (busy) return;
    setShowProblems(true);
    setServerError(null);
    if (problems.length > 0 || !lookups.ready) return;
    setBusy(activate ? 'activate' : 'save');
    try {
      // "Save" leaves a rule as it is (a new one is saved switched off); "Save and Activate" switches it on.
      const isActive = activate || (rule?.isActive ?? false);
      const payload = payloadFromForm(form, lookups.catalog, isActive);
      if (!rule) await routingApi.create(payload);
      else await saveEdit(rule, payload);
      await refresh(qc);
      toast(t('saved'), 'success');
      router.push('/auto-assignment');
    } catch (e) {
      if (isCode(e, 'PLAN_FEATURE_LOCKED')) setLocked(true);
      setServerError(
        isCode(e, 'ROW_VERSION_CONFLICT')
          ? t('conflict')
          : isCode(e, 'PLAN_LIMIT_REACHED')
            ? t('limit')
            : reason(e, t('failed')),
      );
    } finally {
      setBusy(null);
    }
  }

  const users = assignees.data?.users ?? [];
  const teams = assignees.data?.teams ?? [];
  const rows: Array<{ id: string; label: string; note: string; kind: 'user' | 'team' }> = [
    ...users.map((u) => ({
      id: u.id,
      label: u.name ?? u.email,
      note: t('openCount', { open: u.openConversations }),
      kind: 'user' as const,
    })),
    ...teams.map((tm) => ({
      id: tm.id,
      label: tm.name,
      note: t('teamNote', { count: tm.memberCount }),
      kind: 'team' as const,
    })),
  ];
  // A saved target that is not in the picker any more (a removed member) stays visible so it can be taken off.
  const known = new Set(rows.map((r) => r.id));
  const stale = [...form.userIds, ...form.teamIds].filter((x) => !known.has(x));
  const specific = form.strategy === 'specific';

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(rule?.isActive ?? false);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {locked && (
        <PlanPaywall gates={[{ href: pathname, feature: 'inbox_routing' }]} enabled={[]} />
      )}
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          {rule ? t('editTitle') : t('createTitle')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      {serverError && <Alert tone="danger">{serverError}</Alert>}
      {showProblems && problems.length > 0 && <Alert tone="warning">{t('fixProblems')}</Alert>}

      <Card title={t('basics')}>
        <Field
          label={`${t('name')} *`}
          htmlFor={`${uid}-name`}
          error={
            has('name') ? t('problem.name') : has('nameLong') ? t('problem.nameLong') : undefined
          }
        >
          <Input
            id={`${uid}-name`}
            value={form.name}
            maxLength={ROUTING_NAME_MAX + 20}
            placeholder={t('namePlaceholder')}
            invalid={has('name') || has('nameLong')}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
        <Field
          label={t('description')}
          htmlFor={`${uid}-desc`}
          hint={t('descriptionHint')}
          error={has('descriptionLong') ? t('problem.descriptionLong') : undefined}
        >
          <Textarea
            id={`${uid}-desc`}
            rows={2}
            value={form.description}
            maxLength={ROUTING_DESCRIPTION_MAX + 50}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
      </Card>

      <Card title={t('whenTitle')} hint={t('whenHint')}>
        {has('conditions') && <Alert tone="warning">{t('problem.conditions')}</Alert>}
        {has('contactIncomplete') && <Alert tone="warning">{t('problem.contactIncomplete')}</Alert>}

        <Section title={t('contact.title')} hint={t('contact.hint')}>
          <ContactConditions
            root={form.contact}
            onChange={(root) => set('contact', root)}
            showProblems={showProblems}
            catalog={lookups.catalog}
            ready={lookups.ready}
            failed={lookups.failed}
          />
        </Section>

        <Section title={t('channel.title')} hint={t('channel.hint')}>
          <div className="grid gap-2 sm:grid-cols-2">
            {CHANNEL_KINDS.map((k) => (
              <Checkbox
                key={k}
                id={`${uid}-ch-${k}`}
                label={tc(k)}
                checked={form.channelKinds.includes(k)}
                onChange={() => set('channelKinds', toggleId(form.channelKinds, k))}
              />
            ))}
          </div>
        </Section>

        <Section title={t('keywords.title')} hint={t('keywords.hint')}>
          <Textarea
            id={`${uid}-kw`}
            rows={2}
            value={form.keywords}
            placeholder={t('keywords.placeholder')}
            aria-label={t('keywords.title')}
            onChange={(e) => set('keywords', e.target.value)}
          />
          {has('keywordsMany') && (
            <p role="alert" className="text-xs text-danger">
              {t('problem.keywordsMany')}
            </p>
          )}
          <div
            className="flex flex-wrap gap-4 text-sm"
            role="radiogroup"
            aria-label={t('keywords.mode')}
          >
            {(['any', 'all'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${uid}-kwmode`}
                  checked={form.keywordMode === m}
                  onChange={() => set('keywordMode', m)}
                />
                {t(`keywords.${m}`)}
              </label>
            ))}
          </div>
        </Section>

        <Section title={t('language.title')} hint={t('language.hint')}>
          <Input
            value={form.languages}
            dir="ltr"
            placeholder="en, ar"
            aria-label={t('language.title')}
            onChange={(e) => set('languages', e.target.value)}
          />
        </Section>

        <Section title={t('hours.title')} hint={t('hours.hint')}>
          <Select
            value={form.businessHours}
            aria-label={t('hours.title')}
            onChange={(e) => set('businessHours', e.target.value as RuleForm['businessHours'])}
          >
            <option value="any">{t('hours.any')}</option>
            <option value="inside">{t('hours.inside')}</option>
            <option value="outside">{t('hours.outside')}</option>
          </Select>
        </Section>
      </Card>

      <Card title={t('thenTitle')} hint={t('thenHint')}>
        <Field
          label={t('strategy')}
          htmlFor={`${uid}-strategy`}
          hint={t(`strategyHint.${form.strategy}`)}
        >
          <Select
            id={`${uid}-strategy`}
            value={form.strategy}
            onChange={(e) => {
              const strategy = e.target.value as RoutingStrategy;
              setForm((f) => ({
                ...f,
                strategy,
                // "A specific agent" is one person: keep the first pick and drop the teams
                ...(strategy === 'specific' ? { userIds: f.userIds.slice(0, 1), teamIds: [] } : {}),
              }));
            }}
          >
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {ts(s)}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('agents')} *</legend>
          <p className="text-xs text-muted-foreground">{t('agentsHint')}</p>
          {assignees.isPending ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t('loadingAgents')}
            </p>
          ) : assignees.isError ? (
            <Alert tone="warning">{t('agentsFailed')}</Alert>
          ) : rows.length === 0 ? (
            <Alert tone="info">{t('noAgents')}</Alert>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {rows
                .filter((r) => !specific || r.kind === 'user')
                .map((r) => {
                  const list = r.kind === 'user' ? form.userIds : form.teamIds;
                  const checked = list.includes(r.id);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-1 py-1">
                      <Checkbox
                        id={`${uid}-t-${r.id}`}
                        label={
                          <span>
                            {r.label}{' '}
                            {r.kind === 'team' && <Badge tone="neutral">{t('teamBadge')}</Badge>}
                          </span>
                        }
                        checked={checked}
                        onChange={() => {
                          if (specific) {
                            set('userIds', checked ? [] : [r.id]);
                          } else if (r.kind === 'user') {
                            set('userIds', toggleId(form.userIds, r.id));
                          } else {
                            set('teamIds', toggleId(form.teamIds, r.id));
                          }
                        }}
                      />
                      <span className="text-xs text-muted-foreground">{r.note}</span>
                    </li>
                  );
                })}
            </ul>
          )}
          {stale.length > 0 && (
            <Alert tone="warning">
              {t('stale', { count: stale.length })}{' '}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    userIds: f.userIds.filter((x) => known.has(x)),
                    teamIds: f.teamIds.filter((x) => known.has(x)),
                  }))
                }
              >
                {t('removeStale')}
              </button>
            </Alert>
          )}
          {has('targets') && (
            <p role="alert" className="text-xs text-danger">
              {t('problem.targets')}
            </p>
          )}
          {has('specific') && (
            <p role="alert" className="text-xs text-danger">
              {t('problem.specific')}
            </p>
          )}
        </fieldset>
      </Card>

      <Card title={t('optionsTitle')}>
        <div className="flex items-start gap-3">
          <Switch
            checked={form.stopOnMatch}
            onCheckedChange={(v) => set('stopOnMatch', v)}
            label={t('stopOnMatch')}
          />
          <div>
            <p className="text-sm font-medium">{t('stopOnMatch')}</p>
            <p className="text-xs text-muted-foreground">{t('stopOnMatchHint')}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Switch
            checked={form.isFallback}
            onCheckedChange={(v) => set('isFallback', v)}
            label={t('fallback')}
          />
          <div>
            <p className="text-sm font-medium">{t('fallback')}</p>
            <p className="text-xs text-muted-foreground">{t('fallbackHint')}</p>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Link href="/auto-assignment">
          <Button type="button" variant="secondary">
            {t('cancel')}
          </Button>
        </Link>
        <Button type="submit" variant="secondary" disabled={busy !== null}>
          {busy === 'save' && <Spinner />}
          {t('save')}
        </Button>
        {!rule?.isActive && (
          <Button type="button" disabled={busy !== null} onClick={() => void submit(true)}>
            {busy === 'activate' && <Spinner />}
            {t('saveActivate')}
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * An edit sends the version the form was opened at. The engine moves a rule's version every time it fires, so when that is all that changed
 * (the rule is the same as the person opened it) the save takes the current version once; if somebody else edited it, the person is told.
 */
async function saveEdit(rule: RoutingRule, payload: ReturnType<typeof payloadFromForm>) {
  const body = {
    name: payload.name,
    description: payload.description,
    conditions: payload.conditions,
    assign: payload.assign,
    stopOnMatch: payload.stopOnMatch,
    isFallback: payload.isFallback,
    isActive: payload.isActive,
  };
  try {
    await routingApi.update(rule.id, { rowVersion: rule.rowVersion, ...body });
  } catch (e) {
    if (!isCode(e, 'ROW_VERSION_CONFLICT')) throw e;
    const fresh = await routingApi.get(rule.id);
    if (editableOf(fresh) !== editableOf(rule)) throw e;
    await routingApi.update(rule.id, { rowVersion: fresh.rowVersion, ...body });
  }
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-background p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-medium">{title}</h3>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}
