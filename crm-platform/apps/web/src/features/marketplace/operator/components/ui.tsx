'use client';

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type {
  ConnectorKind,
  MarketAppKind,
  MarketAppStatus,
  MarketRequestStatus,
  MarketScopeSummary,
  MarketVersionStatus,
} from '@crm/contracts';
import { Alert, Badge, Button, Card, Spinner } from '@crm/ui';
import { NoAccess } from '@/features/roles-permissions/ui/states';
import { useMyPermissions } from '@/features/roles-permissions/ui/access';
import { isNoAccess, marketError, type MarketError } from '../lib/errors';
import {
  MARKET_PERMISSIONS,
  marketAccess,
  missingReadPermission,
  type MarketAccess,
} from '../lib/permissions';
import { appStatusTone, requestStatusTone, versionStatusTone, type ChipTone } from '../lib/status';

const NS = 'marketplace.operator';

export const linkClass =
  'inline-flex h-10 items-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';
export const primaryLink =
  'inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary';
export const textLink =
  'font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary';

/** A titled card: the section a form step or a detail block lives in. */
export function Section({
  title,
  description,
  actions,
  children,
  tone,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tone?: 'danger';
  id?: string;
}) {
  return (
    <Card
      id={id}
      className={tone === 'danger' ? 'space-y-4 border-danger/40' : 'space-y-4'}
      aria-labelledby={id ? `${id}-title` : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold">
            {title}
          </h2>
          {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

export function LoadingBlock() {
  const t = useTranslations(`${NS}.common`);
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground">
      <Spinner label={t('loading')} />
      <span className="text-sm">{t('loading')}</span>
    </div>
  );
}

/** The sentence for an API failure, in the operator's language. */
export function useErrorText(): (e: unknown | MarketError) => {
  text: string;
  requestId?: string;
  problems: MarketError['problems'];
} {
  const t = useTranslations(`${NS}.errors`);
  return (e) => {
    const info = isMarketError(e) ? e : marketError(e);
    return { text: t(info.key, info.values), requestId: info.requestId, problems: info.problems };
  };
}

function isMarketError(e: unknown): e is MarketError {
  return typeof e === 'object' && e !== null && 'kind' in e && 'key' in e && 'problems' in e;
}

/** A failed read: no-access for a permission refusal, otherwise the reason, the request id and a retry. */
export function Failure({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations(`${NS}.common`);
  const text = useErrorText();
  if (isNoAccess(error)) {
    const permission = marketError(error).values?.permission;
    return <NoAccess permission={permission || undefined} />;
  }
  const { text: message, requestId } = text(error);
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{message}</p>
      {requestId && (
        <p className="text-xs opacity-80">
          {t('requestId')}: <span className="font-mono">{requestId}</span>
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

/** Says why a mutation failed, next to the control that ran it: the sentence, the request id and every `path: message` the API named. */
export function ErrorLine({
  error,
  shownAtFields,
}: {
  error: unknown;
  /** Form fields that already show their own refusal beside the control: their problems are not listed again here. */
  shownAtFields?: readonly string[];
}) {
  const t = useTranslations(`${NS}.common`);
  const text = useErrorText();
  if (!error) return null;
  const { text: message, requestId, problems: all } = text(error);
  const problems = all.filter(
    (p) =>
      !(
        p.target === 'field' &&
        shownAtFields?.some((f) => p.path === f || p.path.startsWith(`${f}.`))
      ),
  );
  return (
    <Alert tone="danger" className="space-y-1 text-sm">
      <p>{message}</p>
      {problems.length > 0 && (
        <ul className="list-disc space-y-0.5 ps-5 text-xs" dir="auto">
          {problems.map((p, i) => (
            <li key={`${p.target}-${p.path}-${i}`}>
              <code className="font-mono" dir="ltr">
                {p.target === 'field' ? p.path : p.path ? `${p.target}.${p.path}` : p.target}
              </code>
              : {p.message}
            </li>
          ))}
        </ul>
      )}
      {requestId && (
        <p className="text-xs opacity-80">
          {t('requestId')}: <span className="font-mono">{requestId}</span>
        </p>
      )}
    </Alert>
  );
}

/**
 * Asks for the caller's own permission map first and shows the no-access page naming the missing key when none of the Marketplace
 * keys is held, so the operator never triggers a denied request (each one is a logged security event). `need="manage"` is for the
 * screens that only make sense to someone who can edit the catalogue. The server stays the authority.
 */
export function MarketGate({
  need = 'read',
  children,
}: {
  need?: 'read' | 'manage';
  children: (access: MarketAccess) => ReactNode;
}) {
  const me = useMyPermissions();
  if (me.isPending) return <LoadingBlock />;
  if (me.isError) return <Failure error={me.error} onRetry={() => void me.refetch()} />;
  const access = marketAccess(me.data.permissions);
  const missing =
    need === 'manage'
      ? access.manage
        ? null
        : MARKET_PERMISSIONS.manage
      : missingReadPermission(access);
  if (missing) return <NoAccess permission={missing} />;
  return <>{children(access)}</>;
}

// --- chips -----------------------------------------------------------------------------------------------------------------------------

export function AppStatusBadge({ status }: { status: MarketAppStatus }) {
  const t = useTranslations(`${NS}.enums.appStatus`);
  return <Badge tone={appStatusTone(status)}>{t(status)}</Badge>;
}

export function VersionStatusBadge({ status }: { status: MarketVersionStatus }) {
  const t = useTranslations(`${NS}.enums.versionStatus`);
  return <Badge tone={versionStatusTone(status)}>{t(status)}</Badge>;
}

export function RequestStatusBadge({ status }: { status: MarketRequestStatus }) {
  const t = useTranslations(`${NS}.enums.requestStatus`);
  return <Badge tone={requestStatusTone(status)}>{t(status)}</Badge>;
}

export function KindLabel({ kind }: { kind: MarketAppKind }) {
  const t = useTranslations(`${NS}.enums.kind`);
  return <>{t(kind)}</>;
}

export function ConnectorLabel({ type }: { type: ConnectorKind }) {
  const t = useTranslations(`${NS}.enums.connector`);
  return <>{t(type)}</>;
}

export function ToneBadge({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <Badge tone={tone}>{children}</Badge>;
}

/** The permissions a version asks for, in the plain words an admin will read, with the risk of each. */
export function ScopeList({
  scopes,
  raw,
}: {
  scopes: readonly MarketScopeSummary[];
  raw?: readonly string[];
}) {
  const t = useTranslations(`${NS}.enums.risk`);
  const tc = useTranslations(`${NS}.common`);
  const known = new Set(scopes.map((s) => s.id));
  const unknown = (raw ?? []).filter((s) => !known.has(s));
  if (scopes.length === 0 && unknown.length === 0) {
    return <span className="text-xs text-muted-foreground">{tc('noPermissions')}</span>;
  }
  return (
    <ul className="space-y-1">
      {scopes.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge tone={s.risk === 'high' ? 'danger' : s.risk === 'medium' ? 'warning' : 'neutral'}>
            {t(s.risk)}
          </Badge>
          <span className="font-medium" dir="auto">
            {s.label}
          </span>
          <code className="font-mono text-muted-foreground" dir="ltr">
            {s.id}
          </code>
        </li>
      ))}
      {unknown.map((id) => (
        <li key={id} className="text-xs">
          <code className="font-mono" dir="ltr">
            {id}
          </code>
        </li>
      ))}
    </ul>
  );
}

/** A read-only JSON block that scrolls inside its own box. */
export function JsonBlock({ value, label }: { value: unknown; label: string }) {
  return (
    <pre
      dir="ltr"
      tabIndex={0}
      aria-label={label}
      className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-3 text-start font-mono text-xs leading-5 focus-visible:ring-2 focus-visible:ring-primary"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
