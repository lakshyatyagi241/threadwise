'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import {
  MAIL_PERSONAL_CONNECTORS,
  type MailPersonalConnector,
  type MailWorkspaceSettings,
} from '@crm/contracts';
import { Button, Select, Spinner, Switch, useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { KEYS, saveEmailSettings } from '../api/mailboxes';
import { mailErrorKey } from '../lib/api-errors';
import { sharingDirty, type SharingDraft } from '../lib/hub-model';

/**
 * "Email sharing" (TW-MAIL-035): the workspace policy of personal mailboxes. Whether people may connect their own mailbox, who may,
 * and whether admins may read them. Turning it off hides the connect option; it never opens an existing personal mailbox to anyone else.
 * Saved with the row version it was read at, so two admins cannot overwrite each other.
 */
export function SharingPanel({ settings }: { settings: MailWorkspaceSettings }) {
  const t = useTranslations('email.sharing');
  const root = useTranslations('email');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<SharingDraft>(() => draftOf(settings));
  const [busy, setBusy] = useState(false);
  // A newer version arrived (after a save or a reload): start the form from it again.
  const [seen, setSeen] = useState(settings.rowVersion);
  if (seen !== settings.rowVersion) {
    setSeen(settings.rowVersion);
    setDraft(draftOf(settings));
  }
  const dirty = sharingDirty(settings, draft);

  const save = async () => {
    setBusy(true);
    try {
      await saveEmailSettings({ ...draft, rowVersion: settings.rowVersion });
      toast(t('saved'), 'success');
      await qc.invalidateQueries({ queryKey: KEYS.all });
    } catch (e) {
      const key = e instanceof ApiError ? mailErrorKey(e.code) : null;
      toast(
        key ? root(`errors.${key}`) : e instanceof ApiError ? e.message : t('failed'),
        'danger',
      );
      if (e instanceof ApiError && e.isRowVersionConflict)
        await qc.invalidateQueries({ queryKey: KEYS.settings });
    } finally {
      setBusy(false);
    }
  };

  const row = 'flex items-start justify-between gap-4';
  return (
    <section
      aria-labelledby="email-sharing"
      data-testid="email-sharing"
      className="space-y-4 rounded-2xl border border-border bg-background p-5 shadow-sm"
    >
      <div>
        <h2 id="email-sharing" className="text-lg leading-tight">
          {t('title')}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('intro')}</p>
      </div>

      <div className={row}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{t('enabled.title')}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('enabled.body')}</p>
        </div>
        <Switch
          label={t('enabled.title')}
          checked={draft.personalMailboxesEnabled}
          disabled={busy}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, personalMailboxesEnabled: v }))}
        />
      </div>

      <div className={row}>
        <div className="min-w-0">
          <label htmlFor="email-who-connects" className="text-[13px] font-semibold">
            {t('who.title')}
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('who.body')}</p>
        </div>
        <Select
          id="email-who-connects"
          className="w-44 shrink-0"
          value={draft.whoMayConnectPersonal}
          disabled={busy || !draft.personalMailboxesEnabled}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              whoMayConnectPersonal: e.target.value as MailPersonalConnector,
            }))
          }
        >
          {MAIL_PERSONAL_CONNECTORS.map((c) => (
            <option key={c} value={c}>
              {t(`who.${c}`)}
            </option>
          ))}
        </Select>
      </div>

      <div className={row}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{t('admins.title')}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('admins.body')}</p>
        </div>
        <Switch
          label={t('admins.title')}
          checked={draft.adminsCanReadPersonal}
          disabled={busy}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, adminsCanReadPersonal: v }))}
        />
      </div>

      <p className="text-xs text-muted-foreground">{t('offNote')}</p>

      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          className="rounded-full"
          disabled={busy || !dirty}
          onClick={() => setDraft(draftOf(settings))}
        >
          {t('reset')}
        </Button>
        <Button
          className="rounded-full"
          disabled={busy || !dirty}
          onClick={() => void save()}
          data-testid="email-sharing-save"
        >
          {busy && <Spinner />} {t('save')}
        </Button>
      </div>
    </section>
  );
}

const draftOf = (s: MailWorkspaceSettings): SharingDraft => ({
  personalMailboxesEnabled: s.personalMailboxesEnabled,
  whoMayConnectPersonal: s.whoMayConnectPersonal,
  adminsCanReadPersonal: s.adminsCanReadPersonal,
});
