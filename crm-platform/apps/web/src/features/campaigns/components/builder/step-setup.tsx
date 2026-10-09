'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Field, Input, Select, Switch } from '@crm/ui';
import type { ComposeSender } from '@crm/contracts';
import { editorType, type BuilderForm } from '../../lib/builder-model';
import { kindsFor } from '../../lib/engine-gate';
import { BubbleIcon, ChoiceCard, FlowIcon, LabelRow, StepCard, TemplateIcon } from './parts';

/** Step 1 (TW-CAMP-003): the name, the sender, what kind of campaign it is, and whether to split-test it. */
export function StepSetup({
  form,
  patch,
  senders,
  engine,
}: {
  form: BuilderForm;
  patch: (p: Partial<BuilderForm>) => void;
  senders: ComposeSender[];
  /** The picked number's engine; a Meta number can only send a template. */
  engine: string;
}) {
  const t = useTranslations('campaigns.builder');
  const kind = editorType(form.type);
  const body = kind === 'text' || kind === 'custom';
  const types = [
    { key: 'custom', type: 'custom', on: body, icon: <BubbleIcon className="size-5" /> },
    {
      key: 'template',
      type: 'template',
      on: kind === 'template',
      icon: <TemplateIcon className="size-5" />,
    },
    { key: 'flow', type: 'flow', on: kind === 'flow', icon: <FlowIcon className="size-5" /> },
  ] as const;
  const offered = kindsFor(engine);
  const shown = types.filter((x) => offered.includes(x.key));

  return (
    <StepCard index="01" title={t('setup.title')} tag={t('steps.required')}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={`${t('setup.name')} *`} htmlFor="camp-name" hint={t('setup.nameHint')}>
          <Input
            id="camp-name"
            value={form.name}
            maxLength={191}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder={t('setup.namePlaceholder')}
          />
        </Field>
        <Field label={`${t('setup.sender')} *`} htmlFor="camp-sender" hint={t('setup.senderHint')}>
          {senders.length === 0 ? (
            <div
              id="camp-sender"
              className="flex min-h-9 items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/5 px-3 text-[12px] text-danger"
            >
              {t('setup.noSenders')}
              <Link href="/channels" className="font-semibold text-brand hover:underline">
                {t('setup.connectOne')}
              </Link>
            </div>
          ) : (
            <Select
              id="camp-sender"
              value={form.senderKey}
              onChange={(e) => patch({ senderKey: e.target.value })}
            >
              <option value="">{t('setup.pickSender')}</option>
              {senders.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label} {s.phone ? `· ${s.phone}` : ''} ({s.engineLabel})
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <div>
        <LabelRow>{`${t('setup.type')} *`}</LabelRow>
        <div
          role="radiogroup"
          aria-label={t('setup.type')}
          className="grid grid-cols-1 gap-3 md:grid-cols-3"
        >
          {shown.map((x) => (
            <ChoiceCard
              key={x.key}
              checked={x.on}
              icon={x.icon}
              title={t(`setup.types.${x.key}.title`)}
              hint={t(`setup.types.${x.key}.hint`)}
              onSelect={() => {
                if (!x.on) patch({ type: x.type });
              }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[12.5px] font-semibold">{t('setup.ab')}</div>
            <div className="text-[11px] text-muted-foreground">{t('setup.abHint')}</div>
          </div>
          <Switch
            checked={form.abTesting}
            onCheckedChange={(abTesting) => patch({ abTesting })}
            label={t('setup.ab')}
          />
        </div>
        {form.abTesting && (
          <div>
            <LabelRow>{t('setup.split', { a: form.abSplit })}</LabelRow>
            <input
              id="camp-split"
              aria-label={t('setup.split', { a: form.abSplit })}
              type="range"
              min={10}
              max={90}
              step={5}
              value={form.abSplit}
              onChange={(e) => patch({ abSplit: Number(e.target.value) })}
              className="w-full accent-[var(--primary)]"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t('setup.splitHint')}</p>
          </div>
        )}
      </div>
    </StepCard>
  );
}
