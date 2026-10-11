'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import type { FlowWidgetSaveInput, Widget } from '@crm/contracts';
import { Button, Spinner, cn, useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { KEYS, saveFlowWidget, useFlowWidget } from '../api/widgets';
import {
  fromWidget,
  newState,
  toPayload,
  validateStep,
  type BuilderState,
} from '../lib/builder-model';
import { BuilderPreview } from './builder-preview';
import { LaunchStep, LookStep, VoiceStep } from './builder-steps';
import type { PreviewDevice } from './launcher-preview';

/** What a new bot's widget starts from: the builder's defaults under the bot's own name, answered by the flow. */
const startingState = (flowName: string): BuilderState => ({
  ...newState(),
  mode: 'ai',
  name: flowName,
});

/**
 * The Customize tab of a website chat bot: the widget's look, with the live preview beside it. Until it has been saved once the
 * bot has no widget (the default look is only a starting point), which is what keeps the reminder on and Publish locked.
 */
export function FlowWidgetCustomize({
  flowId,
  flowName,
  canEdit,
  onSaved,
}: {
  flowId: string;
  flowName: string;
  canEdit: boolean;
  onSaved?: (widget: Widget) => void;
}) {
  const t = useTranslations('chatbotWidget.flowBot.customize');
  const q = useFlowWidget(flowId);
  if (q.isPending) {
    return (
      <div className="flex justify-center p-16">
        <Spinner label={t('loading')} />
      </div>
    );
  }
  if (q.isError) return <p className="p-8 text-center text-[13px] text-danger">{t('loadError')}</p>;
  const widget = q.data.widget;
  return (
    <Panel
      // A save hands back a new row version: the form restarts from what the server stored.
      key={widget?.rowVersion ?? 'new'}
      flowId={flowId}
      initial={widget ? fromWidget(widget) : startingState(flowName)}
      untouched={widget === null}
      canEdit={canEdit}
      onSaved={onSaved}
    />
  );
}

function Panel({
  flowId,
  initial,
  untouched,
  canEdit,
  onSaved,
}: {
  flowId: string;
  initial: BuilderState;
  untouched: boolean;
  canEdit: boolean;
  onSaved?: (widget: Widget) => void;
}) {
  const t = useTranslations('chatbotWidget.flowBot.customize');
  const tb = useTranslations('chatbotWidget.builder');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [s, setS] = useState(initial);
  const [flash, setFlash] = useState<string | null>(null);
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<BuilderState>) => setS((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    for (const step of [2, 3]) {
      const p = validateStep(step, s);
      if (!p.ok) {
        toast(tb(`problem.${p.key}`), 'danger');
        setFlash(p.field);
        window.setTimeout(() => setFlash(null), 2600);
        document.getElementById(`wgt-f-${p.field}`)?.focus();
        return;
      }
    }
    // The bot supplies the name and the answers; only the look is sent.
    const {
      name: _name,
      mode: _mode,
      assistantId: _assistant,
      targetWhatsappCc: _cc,
      targetWhatsappNumber: _number,
      ...look
    } = toPayload(s);
    const body: FlowWidgetSaveInput = {
      ...look,
      ...(s.rowVersion === null ? {} : { rowVersion: s.rowVersion }),
    };
    setBusy(true);
    try {
      const saved = await saveFlowWidget(flowId, body);
      await qc.invalidateQueries({ queryKey: KEYS.flow(flowId) });
      void qc.invalidateQueries({ queryKey: KEYS.webBots });
      toast(t('saved'), 'success');
      onSaved?.(saved);
    } catch (e) {
      const detail = e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.message) : null;
      toast(detail ?? t('saveFailed'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-start gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="min-w-0 space-y-6">
        {untouched ? (
          <p
            role="status"
            data-testid="customize-untouched"
            className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-[12.5px]"
          >
            {t('untouched')}
          </p>
        ) : null}
        <section className="rounded-2xl border border-border bg-background p-4">
          <LookStep s={s} set={set} flash={flash} plain />
        </section>
        <section className="rounded-2xl border border-border bg-background p-4">
          <VoiceStep s={s} set={set} flash={flash} plain />
        </section>
        <section className="rounded-2xl border border-border bg-background p-4">
          <fieldset>
            <legend className="mb-2 text-[11.5px] font-semibold">{t('position')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {(['bottom_right', 'bottom_left'] as const).map((p) => (
                <label
                  key={p}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-[12.5px]',
                    s.position === p ? 'border-brand bg-brand/5' : 'border-border',
                  )}
                >
                  <input
                    type="radio"
                    name="flow-widget-position"
                    checked={s.position === p}
                    onChange={() => set({ position: p })}
                    className="accent-[var(--brand)]"
                  />
                  {t(p === 'bottom_right' ? 'right' : 'left')}
                </label>
              ))}
            </div>
          </fieldset>
        </section>
        <section className="rounded-2xl border border-border bg-background p-4">
          <LaunchStep s={s} set={set} flash={flash} plain snippet={null} onCopy={() => undefined} />
        </section>
        {canEdit ? (
          <div className="sticky bottom-0 -mx-1 flex justify-end border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
            <Button variant="brand" disabled={busy} onClick={() => void save()}>
              {t('save')}
            </Button>
          </div>
        ) : null}
      </div>
      <div className="xl:sticky xl:top-4">
        <BuilderPreview s={s} device={device} onDevice={setDevice} showEngine={false} />
      </div>
    </div>
  );
}
