'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateSwitchesInput, WalletSettings } from '@crm/contracts';
import { Button, Card, ConfirmDialog, Switch } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../../api';
import { errorKind } from '../../lib/errors';

type SwitchName = 'perCountryEnabled' | 'payPerMessage';
const NAMES: readonly SwitchName[] = ['perCountryEnabled', 'payPerMessage'];

/** The two master switches. Each has its own save and its own confirmation, and saving one never touches the other. */
export function SwitchesCard({
  settings,
  canEdit,
}: {
  settings: WalletSettings;
  canEdit: boolean;
}) {
  return (
    <Card className="space-y-5">
      {NAMES.map((name) => (
        <SwitchRow key={name} name={name} settings={settings} canEdit={canEdit} />
      ))}
    </Card>
  );
}

function SwitchRow({
  name,
  settings,
  canEdit,
}: {
  name: SwitchName;
  settings: WalletSettings;
  canEdit: boolean;
}) {
  const t = useTranslations(`wallet-message-billing.admin.pricing.switches.${name}`);
  const tc = useTranslations('wallet-message-billing.common');
  const te = useTranslations('wallet-message-billing.errors');
  const qc = useQueryClient();
  const toast = useToast();
  const saved = settings[name];
  const [draft, setDraft] = useState(saved);
  const [confirm, setConfirm] = useState(false);
  const changed = draft !== saved;
  const id = `switch-${name}`;

  const save = useMutation({
    mutationFn: () => operatorApi.saveSwitches({ [name]: draft } as UpdateSwitchesInput),
    onSuccess: (next) => {
      qc.setQueryData(KEYS.settings, next);
      setDraft(next[name]);
      setConfirm(false);
      toast.success(t(next[name] ? 'savedOn' : 'savedOff'));
    },
    onError: (err) => {
      setConfirm(false);
      toast.error(te(errorKind(err)));
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {t('label')}
        </label>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground" aria-hidden="true">
            {draft ? tc('on') : tc('off')}
          </span>
          <Switch
            id={id}
            checked={draft}
            onCheckedChange={setDraft}
            label={t('label')}
            disabled={!canEdit || save.isPending}
          />
          {canEdit && (
            <Button
              size="sm"
              onClick={() => setConfirm(true)}
              disabled={!changed || save.isPending}
            >
              {t('save')}
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t(draft ? 'on' : 'off')}</p>
      <ConfirmDialog
        open={confirm}
        title={t('confirmTitle')}
        message={t(draft ? 'confirmOn' : 'confirmOff')}
        confirmLabel={t('confirm')}
        cancelLabel={tc('cancel')}
        busy={save.isPending}
        onConfirm={() => save.mutate()}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}
