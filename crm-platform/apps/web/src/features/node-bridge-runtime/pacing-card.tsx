'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { nodeBridgeResponseSchema, type NodeBridgeResponse } from '@crm/contracts';
import { Alert, Button, Card, Field, Input, Switch } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { draftFromPacing, toPacingBody, type PacingDraft, type PacingField } from './lib/draft';
import { errorKind } from './lib/errors';
import { NODE_BRIDGE_QUERY_KEY } from './queries';

const NS = 'node-bridge-runtime';
const LIMITS: Record<PacingField, { min: number; max: number }> = {
  msgGap: { min: 1, max: 600 },
  batchesGap: { min: 1, max: 10000 },
  bwMsgGap: { min: 1, max: 1440 },
};

/** The throttle the bridge applies to bulk sends: gap, batch size, gap between batches, batching on or off (WD-NODE-029). */
export function PacingCard({ data, canEdit }: { data: NodeBridgeResponse; canEdit: boolean }) {
  const t = useTranslations(NS);
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState<PacingDraft>(() => draftFromPacing(data.pacing));
  const [invalid, setInvalid] = useState<PacingField | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: NODE_BRIDGE_QUERY_KEY });
  const save = useMutation({
    mutationFn: (body: unknown) =>
      operatorFetch('/node-bridge/pacing', {
        method: 'PATCH',
        body,
        schema: nodeBridgeResponseSchema,
      }),
    onSuccess: () => {
      toast.success(t('pacing.saved'));
      return refresh();
    },
    onError: (err) => {
      const kind = errorKind(err);
      toast.error(t(`errors.${kind}`));
      if (kind === 'conflict') void refresh();
    },
  });

  const set = (patch: Partial<PacingDraft>) => {
    setInvalid(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = toPacingBody(draft, data.pacingRowVersion);
    if ('error' in r) return setInvalid(r.error);
    save.mutate(r.body);
  };

  const numberField = (field: PacingField) => (
    <Field
      label={t(`pacing.${field}`)}
      htmlFor={`${id}-${field}`}
      hint={t(`pacing.${field}Hint`)}
      error={invalid === field ? t('errors.validation') : undefined}
    >
      <Input
        id={`${id}-${field}`}
        type="number"
        inputMode="numeric"
        {...LIMITS[field]}
        value={draft[field]}
        invalid={invalid === field}
        disabled={!canEdit}
        onChange={(e) => set({ [field]: e.target.value })}
      />
    </Field>
  );

  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('pacing.eyebrow')}
        </p>
        <h2 className="text-lg font-semibold">{t('pacing.title')}</h2>
      </div>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {numberField('msgGap')}
          {numberField('batchesGap')}
          {numberField('bwMsgGap')}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
            <span className="text-sm font-semibold">{t('pacing.enableBatches')}</span>
            <Switch
              checked={draft.enableBatches}
              label={t('pacing.enableBatches')}
              disabled={!canEdit}
              onCheckedChange={(enableBatches) => set({ enableBatches })}
            />
          </div>
        </div>
        {canEdit && (
          <div className="flex justify-end border-t border-border pt-4">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('pacing.updating') : t('pacing.update')}
            </Button>
          </div>
        )}
      </form>
      <Alert tone="info">
        <span className="font-semibold">{t('pacing.tipTitle')}</span> {t('pacing.tip')}
      </Alert>
    </Card>
  );
}
