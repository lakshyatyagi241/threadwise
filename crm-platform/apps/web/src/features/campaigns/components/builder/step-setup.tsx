'use client';

import { useTranslations } from 'next-intl';
import { Field, Input, Select, Switch } from '@crm/ui';
import type { ComposeSender, SenderHidden } from '@crm/contracts';
import { editorType, type BuilderForm } from '../../lib/builder-model';
import { isSmsEngine, kindsFor } from '../../lib/engine-gate';
import { SenderEmptyNotice, SenderLoading } from '../sender-empty';
import { BubbleIcon, ChoiceCard, FlowIcon, LabelRow, StepCard, TemplateIcon } from './parts';

/** Step 1 (TW-CAMP-003): the name, the sender, what kind of campaign it is, and whether to split-test it. */
export function StepSetup({
  form,
  patch,
  senders,
  engine,
  onSender,
  notVerified,
  hidden,
  loading,
}: {
  form: BuilderForm;
  patch: (p: Partial<BuilderForm>) => void;
  senders: ComposeSender[];
  /** The picked number's engine; a Meta number can only send a template. */
  engine: string;
  /** The number was changed (the screen may ask first, a Meta number having its own flow). */
  onSender: (key: string) => void;
  /** The picked number is a Meta number that is not verified: say why the guided flow is not offered. */
  notVerified: boolean;
  /** The numbers the server left out, so an empty list can say why. */
  hidden?: readonly SenderHidden[] | undefined;
  /** The numbers (or the platform switch) are still loading: a skeleton, not an empty list. */
  loading?: boolean | undefined;
}) {
  const t = useTranslations('campaigns.builder');
  const offered = kindsFor(engine);

  return (
    <StepCard index="01" title={t('setup.title')} tag={t('steps.required')}>
      <SetupFields
        name={form.name}
        onName={(name) => patch({ name })}
        senderKey={form.senderKey}
        onSender={onSender}
        senders={senders}
        notVerified={notVerified}
        hidden={hidden}
        loading={loading}
        sms={isSmsEngine(engine)}
      />

      <TypeCards
        value={
          editorType(form.type) === 'template'
            ? 'template'
            : editorType(form.type) === 'flow'
              ? 'flow'
              : 'custom'
        }
        offered={offered}
        onSelect={(type) => patch({ type })}
      />

      {/* The SMS runner sends one text to everyone, so a split test would do nothing: it is not offered. */}
      {!isSmsEngine(engine) && (
        <AbToggle
          checked={form.abTesting}
          split={form.abSplit}
          onChecked={(abTesting) => patch({ abTesting })}
          onSplit={(abSplit) => patch({ abSplit })}
        />
      )}
    </StepCard>
  );
}

/** The name and the sending number: the first fields of Setup, for the classic builder and the guided flow alike. */
export function SetupFields({
  name,
  onName,
  senderKey,
  onSender,
  senders,
  notVerified,
  hidden,
  loading,
  sms,
}: {
  name: string;
  onName: (name: string) => void;
  senderKey: string;
  onSender: (key: string) => void;
  senders: readonly ComposeSender[];
  /** The picked number is a Meta number that is not verified: say why the guided flow is not offered. */
  notVerified: boolean;
  /** The numbers the server left out, so an empty list can say why. */
  hidden?: readonly SenderHidden[] | undefined;
  /** The numbers (or the platform switch) are still loading: a skeleton, not an empty list. */
  loading?: boolean | undefined;
  /** The SMS card: the empty list points at the SMS screen. */
  sms?: boolean | undefined;
}) {
  const t = useTranslations('campaigns.builder');
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label={`${t('setup.name')} *`} htmlFor="camp-name" hint={t('setup.nameHint')}>
        <Input
          id="camp-name"
          value={name}
          maxLength={191}
          onChange={(e) => onName(e.target.value)}
          placeholder={t('setup.namePlaceholder')}
        />
      </Field>
      <Field label={`${t('setup.sender')} *`} htmlFor="camp-sender" hint={t('setup.senderHint')}>
        {loading ? (
          <SenderLoading id="camp-sender" />
        ) : senders.length === 0 ? (
          <SenderEmptyNotice id="camp-sender" hidden={hidden} sms={sms ?? false} />
        ) : (
          <Select id="camp-sender" value={senderKey} onChange={(e) => onSender(e.target.value)}>
            <option value="">{t('setup.pickSender')}</option>
            {senders.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} {s.phone ? `· ${s.phone}` : ''} ({s.engineLabel})
              </option>
            ))}
          </Select>
        )}
        {notVerified && (
          <p role="note" className="mt-1.5 text-[11px] text-warning">
            {t('setup.notVerified')}
          </p>
        )}
      </Field>
    </div>
  );
}

type TypeKey = 'custom' | 'template' | 'flow';

/**
 * The "Campaign type" cards: a custom message, a template, a flow. `offered` is what the number can send (see `kindsFor`). The classic
 * builder hides what is not offered; the guided flow (`blockedReason` given) shows every card and disables the ones that are not,
 * with the reason said once under the cards, so nothing the builder knows disappears from the screen.
 */
export function TypeCards({
  value,
  offered,
  onSelect,
  blockedReason,
}: {
  value: TypeKey;
  offered: readonly TypeKey[];
  onSelect: (type: TypeKey) => void;
  blockedReason?: string | undefined;
}) {
  const t = useTranslations('campaigns.builder');
  const types = [
    { key: 'custom', icon: <BubbleIcon className="size-5" /> },
    { key: 'template', icon: <TemplateIcon className="size-5" /> },
    { key: 'flow', icon: <FlowIcon className="size-5" /> },
  ] as const;
  const shown = blockedReason ? types : types.filter((x) => offered.includes(x.key));
  return (
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
            checked={x.key === value}
            disabled={!offered.includes(x.key)}
            icon={x.icon}
            title={t(`setup.types.${x.key}.title`)}
            hint={t(`setup.types.${x.key}.hint`)}
            onSelect={() => {
              if (x.key !== value) onSelect(x.key);
            }}
          />
        ))}
      </div>
      {blockedReason && shown.some((x) => !offered.includes(x.key)) && (
        <p role="note" className="mt-2 text-[11.5px] text-muted-foreground">
          {blockedReason}
        </p>
      )}
    </div>
  );
}

/** "Enable A/B test": two message variants and the share that gets variant A. */
export function AbToggle({
  checked,
  split,
  onChecked,
  onSplit,
}: {
  checked: boolean;
  split: number;
  onChecked: (on: boolean) => void;
  onSplit: (a: number) => void;
}) {
  const t = useTranslations('campaigns.builder');
  return (
    <div className="space-y-3 rounded-xl border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[12.5px] font-semibold">{t('setup.ab')}</div>
          <div className="text-[11px] text-muted-foreground">{t('setup.abHint')}</div>
        </div>
        <Switch checked={checked} onCheckedChange={onChecked} label={t('setup.ab')} />
      </div>
      {checked && (
        <div>
          <LabelRow>{t('setup.split', { a: split })}</LabelRow>
          <input
            id="camp-split"
            aria-label={t('setup.split', { a: split })}
            type="range"
            min={10}
            max={90}
            step={5}
            value={split}
            onChange={(e) => onSplit(Number(e.target.value))}
            className="w-full accent-[var(--primary)]"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">{t('setup.splitHint')}</p>
        </div>
      )}
    </div>
  );
}
