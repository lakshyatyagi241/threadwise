'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { WIDGET_LIMITS, type WidgetAssistantRef } from '@crm/contracts';
import { cn } from '@crm/ui';
import { snippetFor, type BuilderState } from '../lib/builder-model';
import { CheckIcon, EngineGlyph, ExternalIcon } from './icons';
import { ColorField } from './color-field';
import { PhoneField } from './phone-field';

const INPUT =
  'w-full rounded-lg border bg-background px-3 py-2 text-[12.5px] outline-none focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/10';
const LABEL = 'mb-1.5 block text-[11.5px] font-semibold';
const HINT = 'mt-1 text-[10.5px] text-muted-foreground';

export interface StepProps {
  s: BuilderState;
  set: (patch: Partial<BuilderState>) => void;
  /** The control currently flashed after a failed check. */
  flash: string | null;
  /** Drop the step number: the step sits on a page that is not the numbered wizard (a flow bot's Customize tab). */
  plain?: boolean;
}

const ring = (flash: string | null, field: string) =>
  flash === field ? 'border-danger ring-2 ring-danger/40' : 'border-border';

function StepHead({ n, title, tag }: { n: string | null; title: string; tag: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      {n === null ? null : (
        <span className="inline-flex size-[23px] shrink-0 items-center justify-center rounded-[7px] bg-muted font-mono text-[10px] font-semibold text-brand">
          {n}
        </span>
      )}
      <span className="flex-1 text-lg leading-none">{title}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{tag}</span>
    </div>
  );
}

const ENGINE_TINT = {
  ai: 'bg-emerald-100 text-emerald-900',
  whatsapp: 'bg-sky-100 text-sky-900',
  both: 'bg-violet-100 text-violet-900',
} as const;

export function SetupStep({
  s,
  set,
  flash,
  assistants,
  defaultIso,
}: StepProps & { assistants: WidgetAssistantRef[]; defaultIso: string | null | undefined }) {
  const t = useTranslations('chatbotWidget.builder.setup');
  const needsAi = s.mode === 'ai' || s.mode === 'both';
  const needsWa = s.mode === 'whatsapp' || s.mode === 'both';
  return (
    <div data-step="1">
      <StepHead n="01" title={t('title')} tag={t('required')} />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="wgt-f-name"
            className={cn(LABEL, 'flex items-center justify-between gap-2')}
          >
            {t('name')} <span className="text-danger">*</span>
          </label>
          <input
            id="wgt-f-name"
            type="text"
            value={s.name}
            maxLength={WIDGET_LIMITS.name}
            placeholder={t('namePlaceholder')}
            aria-invalid={flash === 'name' || undefined}
            onChange={(e) => set({ name: e.target.value })}
            className={cn(INPUT, ring(flash, 'name'))}
          />
          <div className={HINT}>{t('nameHint')}</div>
        </div>
        <div>
          <label
            htmlFor="wgt-f-position"
            className={cn(LABEL, 'flex items-center justify-between gap-2')}
          >
            {t('position')} <span className="text-danger">*</span>
          </label>
          <select
            id="wgt-f-position"
            value={s.position}
            onChange={(e) => set({ position: e.target.value as BuilderState['position'] })}
            className={cn(INPUT, 'border-border')}
          >
            <option value="bottom_right">{t('bottomRight')}</option>
            <option value="bottom_left">{t('bottomLeft')}</option>
          </select>
          <div className={HINT}>{t('positionHint')}</div>
        </div>
      </div>

      <fieldset className="mb-4">
        <legend className={cn(LABEL, 'mb-2 flex w-full items-center justify-between gap-2')}>
          {t('engine')} <span className="text-danger">*</span>
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(['ai', 'whatsapp', 'both'] as const).map((mode) => {
            const active = s.mode === mode;
            return (
              <label
                key={mode}
                data-mode-tile={mode}
                className={cn(
                  'cursor-pointer rounded-2xl border p-4 transition',
                  active ? 'border-brand bg-emerald-50 dark:bg-emerald-950/30' : 'border-border',
                  'focus-within:ring-2 focus-within:ring-primary',
                )}
              >
                <input
                  type="radio"
                  name="wgt-mode"
                  value={mode}
                  checked={active}
                  onChange={() => set({ mode })}
                  className="sr-only"
                />
                <div className="mb-3 flex items-start justify-between">
                  <span
                    className={cn('grid size-10 place-items-center rounded-xl', ENGINE_TINT[mode])}
                  >
                    <EngineGlyph kind={mode} className="size-5" />
                  </span>
                  <span
                    className={cn(
                      'grid size-5 place-items-center rounded-full bg-brand text-brand-foreground transition',
                      active ? 'opacity-100' : 'opacity-0',
                    )}
                    aria-hidden="true"
                  >
                    <CheckIcon className="size-3" />
                  </span>
                </div>
                <div className="text-lg leading-tight">{t(`mode.${mode}.title`)}</div>
                <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
                  {t(`mode.${mode}.body`)}
                </p>
              </label>
            );
          })}
        </div>
      </fieldset>

      {needsAi && (
        <div className="mb-4">
          <label htmlFor="wgt-f-assistantId" className={LABEL}>
            {t('agent')}
          </label>
          <select
            id="wgt-f-assistantId"
            value={s.assistantId}
            aria-invalid={flash === 'assistantId' || undefined}
            onChange={(e) => set({ assistantId: e.target.value })}
            className={cn(INPUT, ring(flash, 'assistantId'))}
          >
            <option value="">{t('agentPlaceholder')}</option>
            {assistants.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div className={HINT}>
            {t('agentHintBefore')}{' '}
            <Link href="/ai-training" className="font-semibold text-brand underline">
              {t('agentBuild')}
            </Link>{' '}
            {t('agentHintAfter')}
          </div>
        </div>
      )}

      {needsWa && (
        <>
          <div className="mb-3">
            <label htmlFor="wgt-f-phone" className={cn(LABEL, 'block')}>
              {t('whatsapp')} <span className="text-danger">*</span>
            </label>
            <PhoneField
              id="wgt-f-phone"
              cc={s.targetWhatsappCc}
              number={s.targetWhatsappNumber}
              defaultIso={defaultIso}
              onCc={(cc) => set({ targetWhatsappCc: cc })}
              onNumber={(digits) => set({ targetWhatsappNumber: digits })}
              invalid={flash === 'phone'}
            />
            <div className={HINT}>{t('whatsappHint')}</div>
          </div>
          <div>
            <label htmlFor="wgt-f-prefilledMessage" className={LABEL}>
              {t('prefilled')}
            </label>
            <textarea
              id="wgt-f-prefilledMessage"
              rows={2}
              value={s.prefilledMessage}
              maxLength={WIDGET_LIMITS.longText}
              placeholder={t('prefilledPlaceholder')}
              onChange={(e) => set({ prefilledMessage: e.target.value })}
              className={cn(INPUT, 'border-border')}
            />
            <div className={HINT}>{t('prefilledHint')}</div>
          </div>
        </>
      )}
    </div>
  );
}

export function LookStep({ s, set, flash, plain }: StepProps) {
  const t = useTranslations('chatbotWidget.builder.look');
  return (
    <div data-step="2">
      <StepHead n={plain ? null : '02'} title={t('title')} tag={t('tag')} />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="wgt-f-buttonColor" className={LABEL}>
            {t('launcherFill')}
          </label>
          <ColorField
            id="wgt-f-buttonColor"
            label={t('launcherFill')}
            value={s.buttonColor}
            invalid={flash === 'buttonColor'}
            onChange={(v) => set({ buttonColor: v })}
          />
          <div className={HINT}>{t('launcherFillHint')}</div>
        </div>
        <div>
          <label htmlFor="wgt-f-headerBg" className={LABEL}>
            {t('headerTint')}
          </label>
          <ColorField
            id="wgt-f-headerBg"
            label={t('headerTint')}
            value={s.headerBg}
            onChange={(v) => set({ headerBg: v })}
          />
          <div className={HINT}>{t('headerTintHint')}</div>
        </div>
        <div>
          <label htmlFor="wgt-f-headerTextColor" className={LABEL}>
            {t('headerInk')}
          </label>
          <ColorField
            id="wgt-f-headerTextColor"
            label={t('headerInk')}
            value={s.headerTextColor}
            onChange={(v) => set({ headerTextColor: v })}
          />
          <div className={HINT}>{t('headerInkHint')}</div>
        </div>
      </div>

      <div className="mb-4">
        <label htmlFor="wgt-f-headerTitle" className={LABEL}>
          {t('windowTitle')}
        </label>
        <input
          id="wgt-f-headerTitle"
          type="text"
          value={s.headerTitle}
          maxLength={WIDGET_LIMITS.headerTitle}
          placeholder={t('windowTitlePlaceholder')}
          aria-invalid={flash === 'headerTitle' || undefined}
          onChange={(e) => set({ headerTitle: e.target.value })}
          className={cn(INPUT, ring(flash, 'headerTitle'))}
        />
        <div className={HINT}>{t('windowTitleHint')}</div>
      </div>

      <div>
        <label htmlFor="wgt-f-buttonImageUrl" className={LABEL}>
          {t('icon')} <span className="font-normal text-muted-foreground">({t('optional')})</span>
        </label>
        <input
          id="wgt-f-buttonImageUrl"
          type="text"
          value={s.buttonImageUrl}
          maxLength={WIDGET_LIMITS.imageUrl}
          placeholder="https://yoursite.com/logo.png"
          onChange={(e) => set({ buttonImageUrl: e.target.value })}
          className={cn(INPUT, 'border-border')}
        />
        <div className={HINT}>{t('iconHint')}</div>
      </div>
    </div>
  );
}

export function VoiceStep({ s, set, flash, plain }: StepProps) {
  const t = useTranslations('chatbotWidget.builder.voice');
  return (
    <div data-step="3">
      <StepHead n={plain ? null : '03'} title={t('title')} tag={t('tag')} />
      <div className="mb-4">
        <label htmlFor="wgt-f-welcomeMessage" className={LABEL}>
          {t('opening')} <span className="text-danger">*</span>
        </label>
        <textarea
          id="wgt-f-welcomeMessage"
          rows={3}
          value={s.welcomeMessage}
          maxLength={WIDGET_LIMITS.longText}
          placeholder={t('openingPlaceholder')}
          aria-invalid={flash === 'welcomeMessage' || undefined}
          onChange={(e) => set({ welcomeMessage: e.target.value })}
          className={cn(INPUT, ring(flash, 'welcomeMessage'))}
        />
        <div className={HINT}>{t('openingHint')}</div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="wgt-f-messageBubbleColor" className={LABEL}>
            {t('bubbleFill')}
          </label>
          <ColorField
            id="wgt-f-messageBubbleColor"
            label={t('bubbleFill')}
            value={s.messageBubbleColor}
            onChange={(v) => set({ messageBubbleColor: v })}
          />
          <div className={HINT}>{t('bubbleFillHint')}</div>
        </div>
        <div>
          <label htmlFor="wgt-f-messageTextColor" className={LABEL}>
            {t('bubbleInk')}
          </label>
          <ColorField
            id="wgt-f-messageTextColor"
            label={t('bubbleInk')}
            value={s.messageTextColor}
            onChange={(v) => set({ messageTextColor: v })}
          />
          <div className={HINT}>{t('bubbleInkHint')}</div>
        </div>
      </div>

      <fieldset className="mb-4">
        <legend className={cn(LABEL, 'mb-2')}>{t('canvas')}</legend>
        <div className="mb-2 flex gap-2">
          {(['color', 'image'] as const).map((kind) => (
            <label key={kind} className="flex-1 cursor-pointer">
              <input
                type="radio"
                name="wgt-bgkind"
                value={kind}
                checked={s.bodyBgKind === kind}
                onChange={() => set({ bodyBgKind: kind })}
                className="peer sr-only"
              />
              <div className="rounded-lg border border-border p-2 text-center text-xs font-semibold transition hover:border-brand peer-checked:border-brand peer-checked:bg-emerald-50 peer-focus-visible:ring-2 peer-focus-visible:ring-primary dark:peer-checked:bg-emerald-950/30">
                {t(`canvasKind.${kind}`)}
              </div>
            </label>
          ))}
        </div>
        {s.bodyBgKind === 'color' ? (
          <ColorField
            id="wgt-f-bodyBgColor"
            label={t('canvasColour')}
            value={s.bodyBgColor}
            onChange={(v) => set({ bodyBgColor: v })}
          />
        ) : (
          <div>
            <input
              id="wgt-f-bodyBgImageUrl"
              type="text"
              aria-label={t('canvasImage')}
              value={s.bodyBgImageUrl}
              maxLength={WIDGET_LIMITS.imageUrl}
              placeholder="https://yoursite.com/chat-pattern.jpg"
              aria-invalid={flash === 'bodyBgImageUrl' || undefined}
              onChange={(e) => set({ bodyBgImageUrl: e.target.value })}
              className={cn(INPUT, ring(flash, 'bodyBgImageUrl'))}
            />
            <div className={HINT}>{t('canvasImageHint')}</div>
          </div>
        )}
      </fieldset>

      <label className="mb-4 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-muted">
        <span>
          <span className="block text-[12.5px] font-semibold">{t('autoOpen')}</span>
          <span className="block text-[10.5px] text-muted-foreground">{t('autoOpenHint')}</span>
        </span>
        <span className="relative inline-block h-5 w-[34px] shrink-0">
          <input
            type="checkbox"
            role="switch"
            aria-label={t('autoOpen')}
            checked={s.autoOpen}
            onChange={(e) => set({ autoOpen: e.target.checked })}
            className="peer h-0 w-0 opacity-0"
          />
          <span className="absolute inset-0 cursor-pointer rounded-full bg-border transition before:absolute before:bottom-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-background before:transition before:content-[''] peer-checked:bg-brand peer-checked:before:translate-x-[14px] peer-focus-visible:ring-2 peer-focus-visible:ring-primary" />
        </span>
      </label>

      <fieldset>
        <legend className={cn(LABEL, 'mb-2')}>{t('intake')}</legend>
        <p className="mb-2 text-[10.5px] text-muted-foreground">{t('intakeHint')}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              ['collectName', 'name'],
              ['collectEmail', 'email'],
              ['collectPhone', 'phone'],
            ] as const
          ).map(([field, key]) => (
            <label
              key={field}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-2 transition hover:border-brand"
            >
              <input
                type="checkbox"
                checked={s[field]}
                onChange={(e) => set({ [field]: e.target.checked })}
                className="size-4 accent-[var(--brand)]"
              />
              <span className="text-[12.5px]">{t(`intakeField.${key}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

export function LaunchStep({
  s,
  set,
  plain,
  snippet,
  onCopy,
}: StepProps & {
  /** Revealed only after a successful Launch in this page session. */
  snippet: { embedUrl: string; previewUrl: string } | null;
  onCopy: () => void;
}) {
  const t = useTranslations('chatbotWidget.builder.launch');
  return (
    <div data-step="4">
      <StepHead n={plain ? null : '04'} title={t('title')} tag={t('tag')} />
      <div className="mb-4">
        <label htmlFor="wgt-f-buttonLabel" className={LABEL}>
          {t('label')}
        </label>
        <input
          id="wgt-f-buttonLabel"
          type="text"
          value={s.buttonLabel}
          maxLength={WIDGET_LIMITS.buttonLabel}
          placeholder={t('labelPlaceholder')}
          onChange={(e) => set({ buttonLabel: e.target.value })}
          className={cn(INPUT, 'border-border')}
        />
        <div className={HINT}>{t('labelHint')}</div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="wgt-f-actionButtonBg" className={LABEL}>
            {t('fill')}
          </label>
          <ColorField
            id="wgt-f-actionButtonBg"
            label={t('fill')}
            value={s.actionButtonBg}
            onChange={(v) => set({ actionButtonBg: v })}
          />
        </div>
        <div>
          <label htmlFor="wgt-f-actionButtonTextColor" className={LABEL}>
            {t('ink')}
          </label>
          <ColorField
            id="wgt-f-actionButtonTextColor"
            label={t('ink')}
            value={s.actionButtonTextColor}
            onChange={(v) => set({ actionButtonTextColor: v })}
          />
        </div>
      </div>

      {snippet && (
        <div
          data-testid="snippet-block"
          className="mt-4 rounded-2xl border border-emerald-600/30 bg-emerald-50/60 p-4 dark:bg-emerald-950/20"
        >
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
            <CheckIcon className="size-4 text-brand" />
            <span>
              {t.rich('ready', {
                tag: '</body>',
                code: (chunks) => <span className="font-mono">{chunks}</span>,
              })}
            </span>
          </div>
          <pre
            data-testid="snippet"
            className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-foreground p-3 font-mono text-[11.5px] leading-relaxed text-background"
          >
            {snippetFor(snippet.embedUrl)}
          </pre>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[11px] font-semibold text-brand-foreground hover:opacity-90"
            >
              {t('copy')}
            </button>
            <a
              href={snippet.previewUrl}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold hover:border-brand hover:text-brand"
            >
              <ExternalIcon className="size-3" />
              {t('preview')}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
