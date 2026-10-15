'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { SetupRequirementsResponse, SetupStatusResponse } from '@crm/contracts';
import { Alert, Button, Select, Spinner, cn } from '@crm/ui';
import { LOCALES } from '@/i18n/locales';
import { ApiError } from '@/lib/api/errors';
import { fetchDatabaseDefaults, fetchRequirements, testDatabase } from './setup-api';
import {
  RAIL,
  classifyFailure,
  filterTimezones,
  generateNodeToken,
  railIndex,
  validateAdmin,
  validateApplication,
  validateDatabase,
  validateNode,
  type Problem,
  type Screen,
  type SetupFailure,
  type WizardDraft,
} from './setup-draft';
import {
  BackButton,
  Cross,
  FailureBox,
  NS,
  NavRow,
  PrimaryButton,
  ProblemBox,
  StepHeader,
  Tick,
  WizardField,
  WizardInput,
  cardClass,
  labelClass,
  panelClass,
  richTags,
  tileClass,
} from './wizard-ui';

export interface ScreenProps {
  draft: WizardDraft;
  set: (patch: Partial<WizardDraft>) => void;
  go: (screen: Screen) => void;
  status: SetupStatusResponse;
}

const TOTAL = RAIL.length;

/** The failure sentence for the problems every screen can hit (token, disabled, completed, unexpected). */
export function failureText(t: ReturnType<typeof useTranslations>, f: SetupFailure): string | null {
  switch (f.kind) {
    case 'token':
      return t('problems.token');
    case 'disabled':
      return t('disabled');
    case 'outOfOrder':
      return t('problems.outOfOrder');
    case 'licence':
      return t(`problems.licence.${f.reason}`);
    case 'prerequisites':
      return t('problems.prerequisites', {
        items: f.failed
          .map((k) => (t.has(`problems.keys.${k}`) ? t(`problems.keys.${k}`) : k))
          .join(', '),
      });
    case 'step':
      return `${t('problems.step')}`;
    case 'unknown':
      return `${t('problems.unknown')}`;
    default:
      return null;
  }
}

// --- welcome (TW-INST-002) ---------------------------------------------------------------------------------------

const TILES: Array<[key: 'database' | 'security' | 'translations' | 'admin', svg: ReactNode]> = [
  [
    'database',
    <>
      <rect x="3" y="3" width="10" height="3" rx="1.2" />
      <rect x="3" y="6.5" width="10" height="3" rx="1.2" />
      <rect x="3" y="10" width="10" height="3" rx="1.2" />
    </>,
  ],
  [
    'security',
    <>
      <path d="M8 2l5 2v4c0 3-2.2 5.5-5 6-2.8-.5-5-3-5-6V4z" />
      <path d="M5.8 8l1.6 1.6 3-3" />
    </>,
  ],
  [
    'translations',
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2 2 2.5 4 2.5 6S10 12 8 14M8 2c-2 2-2.5 4-2.5 6S6 12 8 14" />
    </>,
  ],
  [
    'admin',
    <>
      <circle cx="6" cy="6" r="2.5" />
      <path d="M2 14c0-3 1.7-5 4-5s4 2 4 5" />
      <circle cx="11.5" cy="7" r="2" />
      <path d="M9 14c0-2 1.5-3.5 3-3.5s3 1.5 3 3.5" />
    </>,
  ],
];

export function WelcomeScreen({
  draft,
  set,
  status,
  busy,
  problems,
  failure,
  onBegin,
}: ScreenProps & {
  busy: boolean;
  problems: Problem[];
  failure: SetupFailure | null;
  onBegin: () => void;
}) {
  const t = useTranslations(`${NS}.welcome`);
  const root = useTranslations(NS);
  const id = useId();
  const disabled = !status.tokenConfigured;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy && !disabled) onBegin();
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="space-y-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand rtl:font-sans rtl:tracking-normal">
          {t('eyebrow')}
        </div>
        <h1 className="font-serif text-[26px] leading-tight tracking-[-0.01em]">
          {t.rich('title', { ...richTags, app: root('brand') })}
        </h1>
        <p className="max-w-[520px] text-[12.5px] leading-relaxed text-muted-foreground">
          {t('intro')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {TILES.map(([key, svg]) => (
          <div
            key={key}
            className="rounded-2xl border border-border bg-background px-4 py-3.5 shadow-sm"
          >
            <span className="mb-2 grid size-7 place-items-center rounded-lg bg-primary/15 text-brand">
              <svg
                viewBox="0 0 16 16"
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                {svg}
              </svg>
            </span>
            <div className={labelClass}>{t(`tiles.${key}`)}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
        <div className={cn(labelClass, 'mb-2')}>{t('beforeTitle')}</div>
        <ul className="list-disc space-y-1.5 ps-5 text-[12.5px] leading-relaxed">
          <li>{t('before.database')}</li>
          <li>{t('before.runtime')}</li>
          <li>{t('before.token')}</li>
        </ul>
      </div>

      {disabled && (
        <Alert tone="warning" className="rounded-2xl">
          {root('disabled')}
        </Alert>
      )}
      <label htmlFor={`${id}-token`} className="block">
        <span className={labelClass}>{t('tokenLabel')}</span>
        <WizardInput
          id={`${id}-token`}
          type="password"
          value={draft.setupToken}
          onChange={(e) => set({ setupToken: e.target.value })}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          invalid={problems.length > 0}
          className="mt-1 font-mono"
        />
        <span className="mt-1 block text-[10.5px] text-muted-foreground">{t('tokenHint')}</span>
      </label>
      <ProblemBox problems={problems} />
      {failure && failureText(root, failure) && (
        <FailureBox>{failureText(root, failure)}</FailureBox>
      )}

      <div className="flex items-center justify-end">
        <PrimaryButton type="submit" busy={busy} disabled={disabled}>
          {t('begin')}
        </PrimaryButton>
      </div>
    </form>
  );
}

// --- licence (TW-INST-003) ---------------------------------------------------------------------------------------

export function LicenceScreen({
  draft,
  set,
  go,
  busy,
  failure,
  verified,
  onVerify,
}: ScreenProps & {
  busy: boolean;
  failure: SetupFailure | null;
  verified: boolean;
  onVerify: () => void;
}) {
  const t = useTranslations(`${NS}.licence`);
  const root = useTranslations(NS);
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onVerify();
      }}
    >
      <StepHeader eyebrow={t('eyebrow')} title={t.rich('title', richTags)} intro={t('intro')} />
      {failure && failureText(root, failure) && (
        <FailureBox>{failureText(root, failure)}</FailureBox>
      )}
      {verified && (
        <Alert tone="success" className="rounded-2xl px-4 py-2.5 text-[12.5px] font-medium">
          {t('verified')}
        </Alert>
      )}
      <div className={cardClass}>
        <WizardField label={t('label')}>
          <WizardInput
            value={draft.purchaseCode}
            onChange={(e) => set({ purchaseCode: e.target.value })}
            placeholder={t('placeholder')}
            autoFocus
            spellCheck={false}
            className="font-mono"
          />
        </WizardField>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t.rich('help', richTags)}
        </p>
        <NavRow>
          <button
            type="button"
            onClick={() => go('welcome')}
            className="text-[12px] text-muted-foreground transition hover:text-foreground"
          >
            ← {root('back')}
          </button>
          <PrimaryButton type="submit" busy={busy}>
            {t('submit')}
          </PrimaryButton>
        </NavRow>
      </div>
    </form>
  );
}

// --- requirements (TW-INST-004) ---------------------------------------------------------------------------------

function Tiles({
  tiles,
  label,
}: {
  tiles: Array<{ key: string; ok: boolean }>;
  label: (k: string) => string;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {tiles.map((tile) => (
        <div key={tile.key} className={tileClass}>
          <span className="truncate font-mono text-[11.5px]">{label(tile.key)}</span>
          {tile.ok ? <Tick className="text-brand" /> : <Cross className="text-danger" />}
        </div>
      ))}
    </div>
  );
}

function Panel({
  title,
  tiles,
  children,
}: {
  title: string;
  tiles?: Array<{ ok: boolean }>;
  children: ReactNode;
}) {
  const passed = tiles?.filter((x) => x.ok).length ?? 0;
  return (
    <div className={panelClass}>
      <div className="mb-2.5 flex items-center justify-between">
        <span className={labelClass}>{title}</span>
        {tiles && (
          <span
            className={cn(
              'font-mono text-[10.5px] font-semibold',
              passed === tiles.length ? 'text-brand' : 'text-danger',
            )}
          >
            {passed}/{tiles.length}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function RequirementsScreen({
  draft,
  go,
  onFailure,
}: ScreenProps & { onFailure: (f: SetupFailure) => void }) {
  const t = useTranslations(`${NS}.requirements`);
  const root = useTranslations(NS);
  const [data, setData] = useState<SetupRequirementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [round, setRound] = useState(0);
  const recheck = () => {
    setLoading(true);
    setError(false);
    setRound((n) => n + 1);
  };

  useEffect(() => {
    let alive = true;
    fetchRequirements(draft.setupToken.trim())
      .then((r) => alive && setData(r))
      .catch((e: unknown) => {
        if (!alive) return;
        const f = classifyFailure(e);
        if (f.kind === 'token' || f.kind === 'completed' || f.kind === 'disabled') onFailure(f);
        else setError(true);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // `round` re-runs the check when the person presses "Check again"; the token only changes on the first screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, draft.setupToken]);

  const serviceLabel = (k: string) => t(`tiles.${k}`);
  const dirLabel = (k: string) => (k === 'migrations' ? t('tiles.migrationsDir') : t(`tiles.${k}`));
  const extMissing = data
    ? ['citext', 'pg_trgm', 'pgcrypto', 'vector'].filter(
        (e) => !data.database.extensions.includes(e),
      )
    : [];

  return (
    <div className="space-y-4">
      <StepHeader
        eyebrow={t('eyebrow', { n: railIndex('requirements'), total: TOTAL })}
        title={t.rich('title', richTags)}
        intro={t('intro')}
      />

      {loading && !data && (
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Spinner label={t('checking')} /> {t('checking')}
        </div>
      )}
      {error && <FailureBox>{t('loadFailed')}</FailureBox>}

      {data && (
        <>
          <div
            className={cn(
              'flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-[12.5px] font-semibold',
              data.runtime.ok
                ? 'border-success/40 bg-primary/10 text-brand'
                : 'border-danger/40 bg-danger/10 text-danger',
            )}
          >
            {data.runtime.ok ? <Tick className="size-4" /> : <Cross className="size-4" />}
            <span>
              {data.runtime.ok
                ? t('runtimeOk', { version: data.runtime.version })
                : t('runtimeBad', { version: data.runtime.version })}{' '}
              <span className="font-mono text-[11px] font-medium text-muted-foreground">
                {data.runtime.ok
                  ? t('runtimeOkDetail', { required: data.runtime.required })
                  : t('runtimeBadDetail', { required: data.runtime.required, app: root('brand') })}
              </span>
            </span>
          </div>

          <div className="grid gap-3.5 lg:grid-cols-2">
            <div className="space-y-3.5">
              <Panel title={t('modules')} tiles={data.modules}>
                <Tiles tiles={data.modules} label={(k) => k} />
              </Panel>
              <Panel title={t('services')} tiles={data.services}>
                <Tiles tiles={data.services} label={serviceLabel} />
              </Panel>
            </div>
            <div className="space-y-3.5">
              <Panel title={t('directories')} tiles={data.directories}>
                <Tiles tiles={data.directories} label={dirLabel} />
              </Panel>
              <Panel title={t('database')}>
                <div className="flex flex-wrap gap-1.5">
                  {data.database.engine ? (
                    <>
                      <span className={cn(tileClass, 'gap-1.5 pe-2.5 ps-2.5')}>
                        <Tick className="text-brand" />
                        <span className="font-mono text-[11.5px]">
                          {data.database.engine} {data.database.version}
                        </span>
                      </span>
                      {data.database.extensions
                        .filter((e) => e !== 'plpgsql')
                        .map((e) => (
                          <span key={e} className={cn(tileClass, 'gap-1.5 pe-2.5 ps-2.5')}>
                            <Tick className="text-brand" />
                            <span className="font-mono text-[11.5px]">{e}</span>
                          </span>
                        ))}
                    </>
                  ) : (
                    <div className="text-[12px] italic text-muted-foreground">
                      {t('noDatabase')}
                    </div>
                  )}
                  {!data.database.ok && (
                    <div className="w-full rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11.5px] font-medium text-danger">
                      {data.database.engine === null
                        ? t('databaseRequired')
                        : extMissing.map((e) => t('extensionMissing', { name: e })).join(' ')}
                    </div>
                  )}
                </div>
              </Panel>
            </div>
          </div>
        </>
      )}

      <div className="space-y-2.5">
        {data && !data.allPassed && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-[12px] font-medium">
            <span>{t('fixNotice')}</span>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={recheck}
              disabled={loading}
            >
              {loading ? t('checking') : t('recheck')}
            </Button>
          </div>
        )}
        {error && (
          <div>
            <Button variant="secondary" size="sm" className="rounded-full" onClick={recheck}>
              {t('recheck')}
            </Button>
          </div>
        )}
        <NavRow>
          <BackButton onClick={() => go('welcome')} />
          {data?.allPassed ? (
            <PrimaryButton className="h-10" onClick={() => go('database')}>
              {root('continue')}
            </PrimaryButton>
          ) : (
            <Button
              disabled
              className="h-10 cursor-not-allowed rounded-full bg-border px-6 text-[13px] font-semibold text-muted-foreground"
            >
              {root('continue')}
            </Button>
          )}
        </NavRow>
      </div>
    </div>
  );
}

// --- database (TW-INST-005, -006) -------------------------------------------------------------------------------

export function DatabaseScreen({ draft, set, go }: ScreenProps) {
  const t = useTranslations(`${NS}.database`);
  const root = useTranslations(NS);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const seeded = useRef(false);

  // Start from this deployment's own connection (never its password), once, and only if the person has typed nothing.
  useEffect(() => {
    if (seeded.current || draft.dbName || draft.dbUser) return;
    seeded.current = true;
    fetchDatabaseDefaults(draft.setupToken.trim())
      .then((d) =>
        set({ dbHost: d.host, dbPort: String(d.port), dbName: d.database, dbUser: d.username }),
      )
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runTest() {
    const found = validateDatabase(draft);
    setProblems(found);
    if (found.length) return;
    setTesting(true);
    setResult(null);
    try {
      await testDatabase({
        setupToken: draft.setupToken.trim(),
        host: draft.dbHost.trim(),
        port: Number(draft.dbPort),
        database: draft.dbName.trim(),
        username: draft.dbUser.trim(),
        password: draft.dbPassword,
      });
      setResult({ ok: true, message: t('ok') });
    } catch (e) {
      const f = classifyFailure(e);
      if (f.kind === 'database') {
        setResult({ ok: false, message: f.reason === 'server' ? f.message : t('unreachable') });
      } else if (e instanceof ApiError && e.status === 0) {
        setResult({ ok: false, message: t('networkError', { detail: e.message }) });
      } else {
        setResult({ ok: false, message: failureText(root, f) ?? root('problems.unknown') });
      }
    } finally {
      setTesting(false);
    }
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const found = validateDatabase(draft);
        setProblems(found);
        if (!found.length) go('application');
      }}
    >
      <StepHeader
        eyebrow={t('eyebrow', { n: railIndex('database'), total: TOTAL })}
        title={t.rich('title', richTags)}
        intro={t('intro')}
      />
      <ProblemBox problems={problems.slice(0, 1)} />
      <div className={cardClass}>
        <div className="flex items-center justify-between gap-3">
          <div className={labelClass}>{t('driver')}</div>
          <div className="inline-flex items-center gap-2 rounded-full border border-success/40 bg-primary/15 px-3 py-1 text-[12px] font-semibold text-brand">
            <svg
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <ellipse cx="8" cy="3.5" rx="5.5" ry="2" />
              <path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9" />
              <path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
            </svg>
            {t('driverName')}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <WizardField label={t('host')} className="col-span-2">
            <WizardInput
              value={draft.dbHost}
              onChange={(e) => set({ dbHost: e.target.value })}
              placeholder="127.0.0.1"
              className="font-mono"
            />
          </WizardField>
          <WizardField label={t('port')}>
            <WizardInput
              value={draft.dbPort}
              onChange={(e) => set({ dbPort: e.target.value })}
              placeholder="5432"
              inputMode="numeric"
              className="font-mono"
            />
          </WizardField>
        </div>
        <WizardField label={t('name')}>
          <WizardInput
            value={draft.dbName}
            onChange={(e) => set({ dbName: e.target.value })}
            placeholder={t('namePlaceholder')}
            className="font-mono"
          />
        </WizardField>
        <div className="grid grid-cols-2 gap-3">
          <WizardField label={t('user')}>
            <WizardInput
              value={draft.dbUser}
              onChange={(e) => set({ dbUser: e.target.value })}
              placeholder={t('userPlaceholder')}
              autoComplete="off"
              className="font-mono"
            />
          </WizardField>
          <WizardField label={t('password')}>
            <WizardInput
              type="password"
              value={draft.dbPassword}
              onChange={(e) => set({ dbPassword: e.target.value })}
              autoComplete="new-password"
              className="font-mono"
            />
          </WizardField>
        </div>
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">{t('passwordHint')}</p>

        <div>
          <Button
            variant="secondary"
            className="h-10 w-full rounded-full text-[12.5px] font-semibold"
            onClick={() => void runTest()}
            disabled={testing}
          >
            {testing && <Spinner label={t('testing')} />}
            {testing ? t('testing') : t('test')}
          </Button>
          {result && (
            <Alert
              tone={result.ok ? 'success' : 'danger'}
              className="mt-2 rounded-xl px-3 py-2 text-[12px] font-medium"
              data-testid="db-test-result"
            >
              {result.message}
            </Alert>
          )}
        </div>

        <NavRow>
          <BackButton onClick={() => go('requirements')} />
          <PrimaryButton type="submit" className="h-10">
            {root('continue')}
          </PrimaryButton>
        </NavRow>
      </div>
    </form>
  );
}

// --- application (TW-INST-007) ----------------------------------------------------------------------------------

function TimezoneTypeahead({
  value,
  onPick,
  label,
}: {
  value: string;
  onPick: (tz: string) => void;
  label: string;
}) {
  const t = useTranslations(`${NS}.application`);
  const id = useId();
  const all = useMemo(() => {
    try {
      const zones = Intl.supportedValuesOf('timeZone');
      return zones.includes('UTC') ? zones : ['UTC', ...zones];
    } catch {
      return ['UTC'];
    }
  }, []);
  const [search, setSearch] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => filterTimezones(all, search), [all, search]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const pick = (tz: string) => {
    onPick(tz);
    setSearch(tz);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <WizardInput
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={label}
        aria-autocomplete="list"
        value={search}
        placeholder={t('timezonePlaceholder')}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setSearch(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault();
            pick(matches[active]!);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="pe-9 font-mono"
      />
      <svg
        viewBox="0 0 16 16"
        className="pointer-events-none absolute end-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <path d="M3 6l5 5 5-5" />
      </svg>
      {open && (
        <div
          id={`${id}-list`}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-background shadow-md"
        >
          {matches.map((tz, i) => (
            <div
              key={tz}
              role="option"
              aria-selected={tz === value}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(tz);
              }}
              className={cn(
                'cursor-pointer px-3 py-2 font-mono text-[12.5px] hover:bg-primary/10 hover:text-brand',
                i === active && 'bg-primary/10 text-brand',
              )}
            >
              {tz}
            </div>
          ))}
          {matches.length === 0 && (
            <div className="px-3 py-2 text-[12px] italic text-muted-foreground">
              {t('timezoneEmpty')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Reference's language list, with each language in its own script. */
const LANGUAGE_LABELS: Record<(typeof LOCALES)[number], string> = {
  en: 'English',
  es: 'Español (Spanish)',
  hi: 'हिन्दी (Hindi)',
  ar: 'العربية (Arabic)',
  pt: 'Português',
  ru: 'Русский (Russian)',
  ja: '日本語 (Japanese)',
  de: 'Deutsch (German)',
  fr: 'Français (French)',
  it: 'Italiano',
  ko: '한국어 (Korean)',
  'zh-CN': '简体中文 (Chinese)',
  tr: 'Türkçe',
  id: 'Bahasa Indonesia',
  vi: 'Tiếng Việt',
  th: 'ไทย (Thai)',
  pl: 'Polski',
  nl: 'Nederlands',
  ur: 'اردو (Urdu)',
  he: 'עברית (Hebrew)',
  bn: 'বাংলা (Bengali)',
};

export function ApplicationScreen({ draft, set, go }: ScreenProps) {
  const t = useTranslations(`${NS}.application`);
  const root = useTranslations(NS);
  const [problems, setProblems] = useState<Problem[]>([]);
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const found = validateApplication(draft);
        setProblems(found);
        if (!found.length) go('admin');
      }}
    >
      <StepHeader
        eyebrow={t('eyebrow', { n: railIndex('application'), total: TOTAL })}
        title={t.rich('title', richTags)}
        intro={t('intro')}
      />
      <ProblemBox problems={problems.slice(0, 1)} />
      <div className={cardClass}>
        <div className="grid grid-cols-2 gap-3">
          <WizardField label={t('name')}>
            <WizardInput
              value={draft.appName}
              onChange={(e) => set({ appName: e.target.value })}
              placeholder={root('brand')}
              autoFocus
            />
          </WizardField>
          <WizardField label={t('url')}>
            <WizardInput
              type="url"
              value={draft.appUrl}
              onChange={(e) => set({ appUrl: e.target.value })}
              placeholder={t('urlPlaceholder')}
              className="font-mono"
            />
          </WizardField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={labelClass}>{t('timezone')}</span>
            <div className="mt-1">
              <TimezoneTypeahead
                value={draft.timezone}
                onPick={(timezone) => set({ timezone })}
                label={t('timezone')}
              />
            </div>
          </div>
          <WizardField label={t('locale')}>
            <Select
              value={draft.locale}
              onChange={(e) => set({ locale: e.target.value })}
              className="h-10 rounded-xl bg-muted px-3 text-[13px]"
            >
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_LABELS[code]}
                </option>
              ))}
            </Select>
          </WizardField>
        </div>
        <NavRow>
          <BackButton onClick={() => go('database')} />
          <PrimaryButton type="submit" className="h-10">
            {root('continue')}
          </PrimaryButton>
        </NavRow>
      </div>
    </form>
  );
}

// --- admin (TW-INST-008) ----------------------------------------------------------------------------------------

export function AdminScreen({ draft, set, go }: ScreenProps) {
  const t = useTranslations(`${NS}.admin`);
  const root = useTranslations(NS);
  const [problems, setProblems] = useState<Problem[]>([]);
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const found = validateAdmin(draft);
        setProblems(found);
        if (!found.length) go('node');
      }}
    >
      <StepHeader
        eyebrow={t('eyebrow', { n: railIndex('admin'), total: TOTAL })}
        title={t.rich('title', richTags)}
        intro={t('intro')}
      />
      {/* Reference lists every validation error here, not just the first. */}
      <ProblemBox problems={problems} />
      <div className={cardClass}>
        <div className="grid grid-cols-2 gap-3">
          <WizardField label={t('fullName')}>
            <WizardInput
              value={draft.fullName}
              onChange={(e) => set({ fullName: e.target.value })}
              placeholder={t('fullNamePlaceholder')}
              autoComplete="name"
              autoFocus
            />
          </WizardField>
          <WizardField label={t('email')}>
            <WizardInput
              type="email"
              value={draft.email}
              onChange={(e) => set({ email: e.target.value })}
              placeholder={t('emailPlaceholder')}
              autoComplete="email"
              className="font-mono"
            />
          </WizardField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <WizardField label={t('password')}>
            <WizardInput
              type="password"
              value={draft.password}
              onChange={(e) => set({ password: e.target.value })}
              autoComplete="new-password"
              className="font-mono"
            />
          </WizardField>
          <WizardField label={t('confirm')}>
            <WizardInput
              type="password"
              value={draft.confirm}
              onChange={(e) => set({ confirm: e.target.value })}
              autoComplete="new-password"
              className="font-mono"
            />
          </WizardField>
        </div>
        <WizardField label={t('workspace')}>
          <WizardInput
            value={draft.workspaceName}
            onChange={(e) => set({ workspaceName: e.target.value })}
            placeholder={t('workspacePlaceholder')}
            maxLength={120}
          />
        </WizardField>
        <div className="rounded-xl border border-border bg-muted px-3 py-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          {t('note')}
        </div>
        <NavRow>
          <BackButton onClick={() => go('application')} />
          <PrimaryButton type="submit" className="h-10">
            {root('continue')}
          </PrimaryButton>
        </NavRow>
      </div>
    </form>
  );
}

// --- node bridge (TW-INST-009) ----------------------------------------------------------------------------------

export function NodeScreen({ draft, set, go, onInstall }: ScreenProps & { onInstall: () => void }) {
  const t = useTranslations(`${NS}.node`);
  const [problems, setProblems] = useState<Problem[]>([]);

  // Reference pre-fills a fresh token so the two sides match by construction; here it is made in the browser.
  useEffect(() => {
    if (!draft.nodeToken) set({ nodeToken: generateNodeToken() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const found = validateNode(draft);
        setProblems(found);
        if (!found.length) onInstall();
      }}
    >
      <StepHeader
        eyebrow={t('eyebrow', { n: railIndex('node'), total: TOTAL })}
        title={t.rich('title', richTags)}
        intro={t('intro')}
      />
      <ProblemBox problems={problems} />
      <div className={cardClass}>
        <div className="grid grid-cols-2 gap-3">
          <WizardField label={t('url')} hint={t('urlHint')}>
            <WizardInput
              type="url"
              value={draft.nodeUrl}
              onChange={(e) => set({ nodeUrl: e.target.value })}
              placeholder="http://localhost:8888"
              className="font-mono"
              autoFocus
            />
          </WizardField>
          <WizardField label={t('port')} hint={t('portHint')}>
            <WizardInput
              type="number"
              min={1}
              max={65535}
              value={draft.nodePort}
              onChange={(e) => set({ nodePort: e.target.value })}
              placeholder="8888"
              className="font-mono"
            />
          </WizardField>
        </div>
        <div>
          <label className="block">
            <span className={labelClass}>{t('token')}</span>
            <span className="relative mt-1 block">
              <WizardInput
                value={draft.nodeToken}
                onChange={(e) => set({ nodeToken: e.target.value })}
                spellCheck={false}
                className="pe-28 font-mono text-[12px] tracking-tight"
              />
              <Button
                variant="secondary"
                size="sm"
                className="absolute end-1.5 top-1/2 h-7 -translate-y-1/2 rounded-lg px-3 text-[11px] font-semibold text-brand"
                onClick={() => set({ nodeToken: generateNodeToken() })}
              >
                <svg
                  viewBox="0 0 16 16"
                  className="size-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5V5H11"
                  />
                </svg>
                {t('generate')}
              </Button>
            </span>
          </label>
          <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
            {t('tokenHint')}
          </p>
        </div>
        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted px-3 py-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          <svg
            viewBox="0 0 16 16"
            className="mt-0.5 size-3.5 shrink-0 text-brand"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6.5" />
            <path strokeLinecap="round" d="M8 7.5v4M8 5h.01" />
          </svg>
          <span>{t('info')}</span>
        </div>
        <NavRow>
          <BackButton onClick={() => go('admin')} />
          <PrimaryButton type="submit" className="h-10">
            {t('submit')}
          </PrimaryButton>
        </NavRow>
      </div>
    </form>
  );
}
