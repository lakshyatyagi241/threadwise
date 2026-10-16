'use client';

import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { MetaLeadPage } from '@crm/contracts';
import { Alert, Button, Card, ConfirmDialog, Spinner, useToast } from '@crm/ui';
import { leadKeys } from '../api';
import { disableMetaPage, enableMetaPage } from '../meta-api';
import { blockHintKey, pageActions, withPage, type PageCaps } from '../lib/meta-view';
import { MetaFailure } from './meta-failure';
import { AccessChip, PageStatusChip, SyncChip } from './meta-chips';
import { MetaFormPicker } from './meta-form-picker';
import { useMetaLogin } from './use-meta-login';
import { When } from './ui';

/**
 * One connected Facebook Page: who it is, whether Meta lets us read its leads, whether lead sync is on and healthy, and the few
 * things a person can do about it (grant lead access, reconnect, turn lead sync on or off, choose the lead forms). A button that
 * cannot work yet says why instead of disappearing; the server still decides.
 */
export function MetaPageCard({
  page,
  caps,
  usesLoginConfiguration,
}: {
  page: MetaLeadPage;
  caps: PageCaps;
  usesLoginConfiguration: boolean;
}) {
  const t = useTranslations('lead-sources.meta.page');
  const qc = useQueryClient();
  const { toast } = useToast();
  const login = useMetaLogin();
  const pickerId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [broken, setBroken] = useState(false);

  const acts = pageActions(page);
  const name = page.name ?? page.pageId;

  const toggle = useMutation({
    mutationFn: (kind: 'enable' | 'disable') =>
      kind === 'enable' ? enableMetaPage(page.id) : disableMetaPage(page.id),
    onSuccess: (fresh, kind) => {
      qc.setQueryData(leadKeys.meta, (old: Parameters<typeof withPage>[0] | undefined) =>
        old ? withPage(old, fresh) : old,
      );
      void qc.invalidateQueries({ queryKey: leadKeys.meta, exact: true });
      setConfirmOff(false);
      toast(kind === 'enable' ? t('enabledToast', { name }) : t('disabledToast', { name }));
    },
    onError: () => setConfirmOff(false),
  });

  const busy = toggle.isPending || login.pending;
  // Why a button is held back: the Facebook login stores Page tokens, so it also needs `fb.pages.manage`.
  const loginHint = caps.facebook ? null : 'needFacebook';
  const toggleHint = acts.toggleBlock ? blockHintKey('enable', acts.toggleBlock) : null;
  const pickHint = acts.pickBlock ? blockHintKey('pick', acts.pickBlock) : null;
  const failure = toggle.error ?? login.error;

  return (
    <Card className="space-y-4 p-5" data-testid="meta-page" data-page={page.pageId}>
      <div className="flex flex-wrap items-start gap-3">
        {page.pictureUrl && !broken ? (
          // A Page picture address is signed and can expire: on error the initial takes its place.
          <img
            src={page.pictureUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="size-11 shrink-0 rounded-lg border border-border bg-muted object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-base font-semibold text-muted-foreground"
          >
            {Array.from(name)[0]?.toUpperCase() ?? '?'}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="break-words text-base font-semibold" dir="auto">
            {name}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('pageId')} <code dir="ltr">{page.pageId}</code>
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <PageStatusChip status={page.pageStatus} />
            <AccessChip access={page.leadAccess} />
            <SyncChip state={page.sync.state} />
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground" data-testid="meta-sync-help">
        {t(`stateHelp.${page.sync.state}`)}
      </p>
      {page.leadAccess === 'missing' &&
        page.missingScopes.length > 0 &&
        !usesLoginConfiguration && (
          <p className="text-xs text-muted-foreground">
            {t('missingScopes')} <code dir="ltr">{page.missingScopes.join(', ')}</code>
          </p>
        )}

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t('lastLead')}>
          <When value={page.sync.lastLeadAt} empty={t('never')} />
        </Fact>
        <Fact label={t('lastSweep')}>
          <When value={page.sync.lastSweepAt} empty={t('never')} />
        </Fact>
        <Fact label={t('subscribedAt')}>
          <When value={page.sync.subscribedAt} empty={t('never')} />
        </Fact>
        <Fact label={t('formsConnected')}>
          <span data-testid="meta-forms-count">{page.sync.formsConnected}</span>
        </Fact>
      </dl>

      {page.sync.lastError && (
        <Alert tone="danger" className="text-xs" data-testid="meta-last-error">
          <span className="font-medium">{t('lastError')}</span>{' '}
          <span dir="auto">{page.sync.lastError}</span>
        </Alert>
      )}

      {failure && (
        <MetaFailure
          error={failure}
          login={login}
          canLogin={caps.manage && caps.facebook}
          onRetry={
            toggle.error && toggle.variables ? () => toggle.mutate(toggle.variables!) : undefined
          }
        />
      )}

      {caps.manage ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {acts.login && (
              <Button
                size="sm"
                disabled={busy || loginHint !== null}
                onClick={login.run}
                data-testid={acts.login === 'grant' ? 'meta-grant' : 'meta-reconnect'}
              >
                {login.pending && <Spinner />}
                {acts.login === 'grant' ? t('grant') : t('reconnect')}
              </Button>
            )}
            {acts.toggle === 'enable' ? (
              <Button
                size="sm"
                variant={acts.login ? 'secondary' : 'primary'}
                disabled={busy || toggleHint !== null}
                aria-describedby={toggleHint ? `${pickerId}-hint` : undefined}
                onClick={() => toggle.mutate('enable')}
                data-testid="meta-enable"
              >
                {toggle.isPending && toggle.variables === 'enable' && <Spinner />}
                {t('enable')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirmOff(true)}
                data-testid="meta-disable"
              >
                {toggle.isPending && toggle.variables === 'disable' && <Spinner />}
                {t('disable')}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={pickerOpen}
              aria-controls={pickerId}
              disabled={busy || pickHint !== null}
              aria-describedby={pickHint ? `${pickerId}-pick-hint` : undefined}
              onClick={() => setPickerOpen((v) => !v)}
              data-testid="meta-choose-forms"
            >
              {pickerOpen ? t('hideForms') : t('chooseForms')}
            </Button>
          </div>
          {acts.login && loginHint && (
            <p className="text-xs text-muted-foreground">
              {t(`hints.${loginHint}`, { permission: 'fb.pages.manage' })}
            </p>
          )}
          {acts.toggle === 'enable' && toggleHint && (
            <p id={`${pickerId}-hint`} className="text-xs text-muted-foreground">
              {t(`hints.${toggleHint}`)}
            </p>
          )}
          {pickHint && (
            <p id={`${pickerId}-pick-hint`} className="text-xs text-muted-foreground">
              {t(`hints.${pickHint}`)}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('hints.needManage', { permission: 'leads.sources.manage' })}
        </p>
      )}

      {caps.manage && pickerOpen && pickHint === null && (
        <div id={pickerId}>
          <MetaFormPicker page={page} login={login} canLogin={caps.facebook} />
        </div>
      )}

      {caps.manage && (
        <ConfirmDialog
          open={confirmOff}
          title={t('confirmOff.title', { name })}
          message={t('confirmOff.body')}
          confirmLabel={t('confirmOff.action')}
          cancelLabel={t('confirmOff.cancel')}
          busy={toggle.isPending}
          onConfirm={() => toggle.mutate('disable')}
          onClose={() => setConfirmOff(false)}
        />
      )}
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
