'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type ReactNode } from 'react';
import type { SetupStatusResponse } from '@crm/contracts';
import { Alert, cn } from '@crm/ui';
import { InstallRunScreen } from './install-run';
import {
  AdminScreen,
  ApplicationScreen,
  DatabaseScreen,
  LicenceScreen,
  NodeScreen,
  RequirementsScreen,
  WelcomeScreen,
} from './screens';
import { verifyLicence, verifySetupToken } from './setup-api';
import {
  RAIL,
  classifyFailure,
  emptyDraft,
  railIndex,
  validateToken,
  type Problem,
  type Screen,
  type SetupFailure,
  type WizardDraft,
} from './setup-draft';
import { NS, Tick, richTags } from './wizard-ui';

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** WaDesk's installer chrome: one centred card with the step rail on the left (lg and up) and the screen on the right. */
function WizardFrame({
  screen,
  version,
  children,
}: {
  screen: Screen;
  version: string;
  children: ReactNode;
}) {
  const t = useTranslations(NS);
  const current = railIndex(screen);
  const name = t(`steps.${RAIL[current - 1]!}`);
  return (
    <div className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-[1040px] overflow-hidden rounded-[26px] border border-border bg-background shadow-xl motion-safe:animate-[wiz-card-in_.45s_cubic-bezier(.22,1,.36,1)_both] sm:max-h-[calc(100dvh-3rem)]">
      <aside className="relative hidden w-[300px] shrink-0 flex-col justify-between overflow-hidden border-e border-border bg-muted lg:flex">
        <div className="pointer-events-none absolute -end-16 -top-16 size-52 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative z-10 px-8 pt-8">
          <div className="flex items-center gap-2.5">
            <span
              className="grid size-9 place-items-center rounded-xl bg-brand text-brand-foreground"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v11H9l-5 4z" />
              </svg>
            </span>
            <span className="font-serif text-[23px] leading-none tracking-[-0.01em]">
              {t('brand')}
            </span>
          </div>
          <div className="mt-7 space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand">
              {t('railEyebrow')}
            </div>
            <h2 className="font-serif text-[21px] leading-[1.18] tracking-[-0.01em]">
              {t.rich('railTitle', richTags)}
            </h2>
          </div>
        </div>

        <nav
          className="relative z-10 flex min-h-0 flex-1 items-center px-6 py-6"
          aria-label={t('stepsLabel')}
        >
          <ol className="w-full space-y-0.5">
            {RAIL.map((step, i) => {
              const n = i + 1;
              const done = current > n;
              const active = current === n;
              return (
                <li
                  key={step}
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition-all',
                    active && 'bg-primary/15',
                  )}
                >
                  {done ? (
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/20 text-brand">
                      <Tick />
                    </span>
                  ) : active ? (
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand font-mono text-[12px] font-semibold text-brand-foreground shadow-sm">
                      {n}
                    </span>
                  ) : (
                    <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-background font-mono text-[11px] text-muted-foreground">
                      {n}
                    </span>
                  )}
                  <span
                    className={cn(
                      'font-mono text-[12px] uppercase tracking-[0.14em] rtl:font-sans rtl:tracking-normal',
                      active
                        ? 'font-semibold text-brand'
                        : done
                          ? 'text-foreground'
                          : 'text-muted-foreground',
                    )}
                  >
                    {t(`steps.${step}`)}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="relative z-10 px-8 pb-7">
          <p className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="h-px w-6 bg-border" />
            {t('railFooter', { version })}
          </p>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border px-6 pb-4 pt-6 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <span className="font-serif text-[17px]">{t('brand')}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand">
              {t('mobileStep', { n: current, total: RAIL.length, name })}
            </span>
          </div>
          <div className="mt-3 h-1 w-full rounded-full bg-border" role="presentation">
            <div
              className="h-1 rounded-full bg-brand transition-all duration-500 motion-reduce:transition-none"
              style={{ width: `${(current / RAIL.length) * 100}%` }}
            />
          </div>
        </div>
        <div
          key={screen}
          className="min-h-0 flex-1 overflow-y-auto bg-background px-7 py-7 motion-safe:animate-[wiz-step-in_.3s_ease-out_both] md:px-9"
        >
          {children}
        </div>
      </main>
    </div>
  );
}

/**
 * First-run setup: WaDesk's installer as a client stepper over the setup API (WD-INST-001, -002, -004 to -010).
 * Screens are a convenience only; each server call re-checks the lock, the token and the order of the steps, so
 * skipping a screen by hand gains nothing (the WaDesk wizard's gate lived on its pages).
 */
export function SetupWizard({ status }: { status: SetupStatusResponse }) {
  const t = useTranslations(NS);
  const [screen, setScreen] = useState<Screen>('welcome');
  const [draft, setDraft] = useState<WizardDraft>(() => ({
    ...emptyDraft({
      timezone: browserZone(),
      origin: typeof window === 'undefined' ? '' : window.location.origin,
    }),
    appName: t('brand'),
  }));
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [failure, setFailure] = useState<SetupFailure | null>(null);
  const [licenceOk, setLicenceOk] = useState(false);
  const [finished, setFinished] = useState(false);

  const set = useCallback((patch: Partial<WizardDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setProblems([]);
    setFailure(null);
  }, []);

  const go = useCallback((next: Screen) => {
    setFailure(null);
    setProblems([]);
    setScreen(next);
  }, []);

  /** A refusal from the server that sends the person back to the first screen, where the token lives. */
  const onFailure = useCallback((f: SetupFailure) => {
    setFailure(f);
    if (f.kind === 'completed') setFinished(true);
    else setScreen('welcome');
  }, []);

  async function begin() {
    const found = validateToken(draft);
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    setFailure(null);
    try {
      await verifySetupToken(draft.setupToken.trim());
      setLicenceOk(false);
      setScreen(status.licenceRequired ? 'licence' : 'requirements');
    } catch (e) {
      const f = classifyFailure(e);
      if (f.kind === 'completed') setFinished(true);
      else setFailure(f);
    } finally {
      setBusy(false);
    }
  }

  async function verifyPurchase() {
    setBusy(true);
    setFailure(null);
    try {
      await verifyLicence(draft.setupToken.trim(), draft.purchaseCode.trim());
      setLicenceOk(true);
      setScreen('requirements');
    } catch (e) {
      const f = classifyFailure(e);
      if (f.kind === 'token' || f.kind === 'completed') onFailure(f);
      else setFailure(f);
    } finally {
      setBusy(false);
    }
  }

  const base = { draft, set, go, status };
  const frame = (body: ReactNode) => (
    <WizardFrame screen={screen} version={status.version}>
      {finished ? <Completed /> : body}
    </WizardFrame>
  );

  switch (screen) {
    case 'welcome':
      return frame(
        <WelcomeScreen
          {...base}
          busy={busy}
          problems={problems}
          failure={failure}
          onBegin={() => void begin()}
        />,
      );
    case 'licence':
      return frame(
        <LicenceScreen
          {...base}
          busy={busy}
          failure={failure}
          verified={licenceOk}
          onVerify={() => void verifyPurchase()}
        />,
      );
    case 'requirements':
      return frame(<RequirementsScreen {...base} onFailure={onFailure} />);
    case 'database':
      return frame(<DatabaseScreen {...base} />);
    case 'application':
      return frame(<ApplicationScreen {...base} />);
    case 'admin':
      return frame(<AdminScreen {...base} />);
    case 'node':
      return frame(<NodeScreen {...base} onInstall={() => go('install')} />);
    case 'install':
      return frame(
        <InstallRunScreen
          draft={draft}
          status={status}
          onFailure={onFailure}
          onDone={() => window.location.assign('/admin/login')}
        />,
      );
  }
}

function Completed() {
  const t = useTranslations(`${NS}.completed`);
  return (
    <div className="space-y-4">
      <Alert tone="warning" className="rounded-2xl">
        {t('body')}
      </Alert>
      <Link href="/login" className="text-sm underline">
        {t('login')}
      </Link>
    </div>
  );
}
