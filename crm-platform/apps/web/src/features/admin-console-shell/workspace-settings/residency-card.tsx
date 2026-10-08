'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DATA_RESIDENCY_MODES, type DataResidency } from '@crm/contracts';
import { Alert, Button, Card, Spinner, cn } from '@crm/ui';
import { useResidency, useSaveResidency } from './api';

const NS = 'admin-console-shell.workspaceSettings.residency';

/**
 * TW-ASHELL-045: restricts which translation providers may receive customer message text. Reference put it on the data
 * processing page; here it sits with the other data controls (the port notes ask for Settings > Data) and the DPA page
 * shows the mode. Only the owner sees the form; everyone else reads the current mode.
 */
export function ResidencyCard() {
  const t = useTranslations(NS);
  const q = useResidency();
  if (q.isPending) return <Spinner />;
  if (q.isError || !q.data) return <Alert tone="danger">{t('loadFailed')}</Alert>;
  return <ResidencyForm current={q.data.residency} isOwner={q.data.isOwner} />;
}

function ResidencyForm({ current, isOwner }: { current: DataResidency; isOwner: boolean }) {
  const t = useTranslations(NS);
  const save = useSaveResidency();
  const [value, setValue] = useState<DataResidency>(current);
  const [saved, setSaved] = useState(false);
  return (
    <Card className="space-y-3 p-6">
      <h2 className="font-serif text-xl">{t('title')}</h2>
      <p className="text-xs text-muted-foreground">{t('body')}</p>
      {saved && <Alert tone="success">{t('saved')}</Alert>}
      {save.isError && <Alert tone="danger">{t('saveFailed')}</Alert>}
      {!isOwner ? (
        <p className="text-xs italic text-muted-foreground">{t('ownerOnly')}</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            save.mutate(value, { onSuccess: () => setSaved(true) });
          }}
        >
          <div role="radiogroup" aria-label={t('title')} className="space-y-3">
            {DATA_RESIDENCY_MODES.map((m) => (
              <label
                key={m}
                className={cn(
                  'block cursor-pointer rounded-xl border p-4',
                  value === m ? 'border-primary bg-primary/5' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="data_residency"
                  value={m}
                  checked={value === m}
                  onChange={() => setValue(m)}
                  className="me-2"
                />
                <span className="text-sm font-semibold">{t(`modes.${m}.name`)}</span>
                <p className="ms-5 mt-1 text-xs text-muted-foreground">{t(`modes.${m}.text`)}</p>
              </label>
            ))}
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={save.isPending}>
              {t('save')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
