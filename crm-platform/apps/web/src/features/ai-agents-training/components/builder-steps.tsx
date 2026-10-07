'use client';

import { useTranslations } from 'next-intl';
import { AI_PROVIDERS, AIAG_LIMITS, AIAG_TONES, type AiModelOption } from '@crm/contracts';
import { cn } from '@crm/ui';
import { modelsFor, providersOffered, type BuilderState } from '../lib/builder-model';

const INPUT =
  'w-full rounded-lg border bg-background px-3 py-2 text-[12.5px] outline-none focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/10 disabled:cursor-not-allowed disabled:opacity-60';
const LABEL = 'mb-1.5 block text-[11.5px] font-semibold';
const HINT = 'mt-1 text-[10.5px] text-muted-foreground';

export interface StepProps {
  s: BuilderState;
  set: (patch: Partial<BuilderState>) => void;
  /** The control currently flashed after a failed check. */
  flash: string | null;
  disabled: boolean;
}

const ring = (flash: string | null, field: string) =>
  flash === field ? 'border-danger ring-2 ring-danger/40' : 'border-border';

const fid = (field: string) => `aiag-f-${field}`;

function StepHead({ n, title, tag }: { n: string; title: string; tag: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="inline-flex size-[23px] shrink-0 items-center justify-center rounded-[7px] bg-muted font-mono text-[10px] font-semibold text-brand">
        {n}
      </span>
      <span className="flex-1 text-lg leading-none">{title}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{tag}</span>
    </div>
  );
}

function Req() {
  return (
    <span className="text-danger" aria-hidden="true">
      *
    </span>
  );
}

export function IdentityStep({ s, set, flash, disabled }: StepProps) {
  const t = useTranslations('aiTraining.builder.identity');
  return (
    <div data-step="1">
      <StepHead n="01" title={t('title')} tag={t('required')} />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('name')} className={LABEL}>
            {t('name')} <Req />
          </label>
          <input
            id={fid('name')}
            type="text"
            value={s.name}
            maxLength={AIAG_LIMITS.name}
            disabled={disabled}
            placeholder={t('namePlaceholder')}
            aria-required="true"
            aria-invalid={flash === 'name' || undefined}
            onChange={(e) => set({ name: e.target.value })}
            className={cn(INPUT, ring(flash, 'name'))}
          />
          <div className={HINT}>{t('nameHint')}</div>
        </div>
        <div>
          <label htmlFor={fid('status')} className={LABEL}>
            {t('status')}
          </label>
          <select
            id={fid('status')}
            value={s.status}
            disabled={disabled}
            onChange={(e) => set({ status: e.target.value as BuilderState['status'] })}
            className={cn(INPUT, 'border-border')}
          >
            <option value="active">{t('statusActive')}</option>
            <option value="paused">{t('statusPaused')}</option>
          </select>
          <div className={HINT}>{t('statusHint')}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('language')} className={LABEL}>
            {t('language')}
          </label>
          <input
            id={fid('language')}
            type="text"
            value={s.language}
            maxLength={AIAG_LIMITS.language}
            disabled={disabled}
            placeholder="en"
            onChange={(e) => set({ language: e.target.value })}
            className={cn(INPUT, 'border-border')}
          />
          <div className={HINT}>{t('languageHint')}</div>
        </div>
        <div>
          <label htmlFor={fid('tone')} className={LABEL}>
            {t('tone')}
          </label>
          <select
            id={fid('tone')}
            value={s.tone}
            disabled={disabled}
            onChange={(e) => set({ tone: e.target.value })}
            className={cn(INPUT, 'border-border')}
          >
            {/* A tone saved some other way stays selectable instead of silently turning into the first one. */}
            {!(AIAG_TONES as readonly string[]).includes(s.tone) && (
              <option value={s.tone}>{s.tone}</option>
            )}
            {AIAG_TONES.map((tone) => (
              <option key={tone} value={tone}>
                {t(`tones.${tone}`)}
              </option>
            ))}
          </select>
          <div className={HINT}>{t('toneHint')}</div>
        </div>
      </div>
    </div>
  );
}

export function PersonaStep({ s, set, flash, disabled }: StepProps) {
  const t = useTranslations('aiTraining.builder.persona');
  return (
    <div data-step="2">
      <StepHead n="02" title={t('title')} tag={t('tag')} />
      <div className="mb-4">
        <label htmlFor={fid('greeting')} className={LABEL}>
          {t('greeting')} <Req />
        </label>
        <textarea
          id={fid('greeting')}
          rows={2}
          value={s.greeting}
          maxLength={AIAG_LIMITS.greeting}
          disabled={disabled}
          placeholder={t('greetingPlaceholder')}
          aria-required="true"
          aria-invalid={flash === 'greeting' || undefined}
          onChange={(e) => set({ greeting: e.target.value })}
          className={cn(INPUT, ring(flash, 'greeting'))}
        />
        <div className={HINT}>{t('greetingHint')}</div>
      </div>
      <div>
        <label htmlFor={fid('systemPrompt')} className={LABEL}>
          {t('brief')}
        </label>
        <textarea
          id={fid('systemPrompt')}
          rows={9}
          value={s.systemPrompt}
          maxLength={AIAG_LIMITS.systemPrompt}
          disabled={disabled}
          placeholder={t('briefPlaceholder')}
          onChange={(e) => set({ systemPrompt: e.target.value })}
          className={cn(INPUT, 'border-border')}
        />
        <div className={HINT}>{t('briefHint')}</div>
      </div>
    </div>
  );
}

export function BrainStep({
  s,
  set,
  flash,
  disabled,
  enabled,
  modelsLoaded,
}: StepProps & { enabled: readonly AiModelOption[]; modelsLoaded: boolean }) {
  const t = useTranslations('aiTraining.builder.brain');
  const providers = providersOffered(
    AI_PROVIDERS.filter((p) => p.group === 'llm'),
    enabled,
  );
  const known = providers.some((p) => p.slug === s.aiProvider);
  const suggestions = modelsFor(s.aiProvider, enabled);
  const none = modelsLoaded && enabled.length === 0;

  const pickProvider = (slug: string) => {
    // Moving to another vendor offers that vendor's first enabled model unless the typed one already belongs to it.
    const next = modelsFor(slug, enabled);
    set({
      aiProvider: slug,
      aiModel: next.length > 0 && !next.includes(s.aiModel) ? next[0]! : s.aiModel,
    });
  };

  return (
    <div data-step="3">
      <StepHead n="03" title={t('title')} tag={t('tag')} />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('aiProvider')} className={LABEL}>
            {t('provider')}
          </label>
          <select
            id={fid('aiProvider')}
            value={s.aiProvider}
            disabled={disabled}
            onChange={(e) => pickProvider(e.target.value)}
            className={cn(INPUT, 'border-border')}
          >
            {!known && (
              <option value={s.aiProvider}>{t('notEnabled', { name: s.aiProvider })}</option>
            )}
            {providers.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
          <div className={HINT}>{t('providerHint')}</div>
        </div>
        <div>
          <label htmlFor={fid('aiModel')} className={LABEL}>
            {t('model')} <Req />
          </label>
          <input
            id={fid('aiModel')}
            type="text"
            list="aiag-model-options"
            value={s.aiModel}
            maxLength={AIAG_LIMITS.model}
            disabled={disabled}
            placeholder="gpt-4o-mini"
            aria-required="true"
            aria-invalid={flash === 'aiModel' || undefined}
            onChange={(e) => set({ aiModel: e.target.value })}
            className={cn(INPUT, ring(flash, 'aiModel'))}
          />
          <datalist id="aiag-model-options">
            {suggestions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <div className={cn(HINT, none && 'text-danger')} role={none ? 'status' : undefined}>
            {none ? t('noModels') : t('modelHint')}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('replyMaxTokens')} className={LABEL}>
            {t('tokens')}
          </label>
          <input
            id={fid('replyMaxTokens')}
            type="number"
            min={AIAG_LIMITS.replyMaxTokensMin}
            max={AIAG_LIMITS.replyMaxTokensMax}
            step={1}
            value={s.replyMaxTokens}
            disabled={disabled}
            placeholder="400"
            aria-invalid={flash === 'replyMaxTokens' || undefined}
            onChange={(e) => set({ replyMaxTokens: e.target.value })}
            className={cn(INPUT, ring(flash, 'replyMaxTokens'))}
          />
          <div className={HINT}>{t('tokensHint')}</div>
        </div>
        <div>
          <label htmlFor={fid('temperature')} className={LABEL}>
            {t('temperature')}
          </label>
          <input
            id={fid('temperature')}
            type="number"
            min={AIAG_LIMITS.temperatureMin}
            max={AIAG_LIMITS.temperatureMax}
            step={0.1}
            value={s.temperature}
            disabled={disabled}
            placeholder="0.7"
            aria-invalid={flash === 'temperature' || undefined}
            onChange={(e) => set({ temperature: e.target.value })}
            className={cn(INPUT, ring(flash, 'temperature'))}
          />
          <div className={HINT}>{t('temperatureHint')}</div>
        </div>
      </div>
    </div>
  );
}

export function SafetyStep({ s, set, disabled }: Omit<StepProps, 'flash'>) {
  const t = useTranslations('aiTraining.builder.safety');
  return (
    <div data-step="4">
      <StepHead n="04" title={t('title')} tag={t('tag')} />
      <div className="mb-4">
        <label htmlFor={fid('fallbackMessage')} className={LABEL}>
          {t('fallback')}
        </label>
        <input
          id={fid('fallbackMessage')}
          type="text"
          value={s.fallbackMessage}
          maxLength={AIAG_LIMITS.fallbackMessage}
          disabled={disabled}
          placeholder={t('fallbackPlaceholder')}
          onChange={(e) => set({ fallbackMessage: e.target.value })}
          className={cn(INPUT, 'border-border')}
        />
        <div className={HINT}>{t('fallbackHint')}</div>
      </div>
      <label className="mb-4 flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-border p-3.5 focus-within:ring-2 focus-within:ring-primary">
        <span>
          <span className="block text-[12.5px] font-semibold">{t('handoff')}</span>
          <span className="block text-[11px] text-muted-foreground">{t('handoffHint')}</span>
        </span>
        <input
          id={fid('handoffEnabled')}
          type="checkbox"
          checked={s.handoffEnabled}
          disabled={disabled}
          onChange={(e) => set({ handoffEnabled: e.target.checked })}
          className="size-4 shrink-0 accent-[var(--color-brand,#075e54)]"
        />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('handoffKeyword')} className={LABEL}>
            {t('keyword')}
          </label>
          <input
            id={fid('handoffKeyword')}
            type="text"
            value={s.handoffKeyword}
            maxLength={AIAG_LIMITS.handoffKeyword}
            disabled={disabled}
            placeholder={t('keywordPlaceholder')}
            onChange={(e) => set({ handoffKeyword: e.target.value })}
            className={cn(INPUT, 'border-border')}
          />
          <div className={HINT}>{t('keywordHint')}</div>
        </div>
        <div>
          <label htmlFor={fid('handoffMessage')} className={LABEL}>
            {t('ack')}
          </label>
          <input
            id={fid('handoffMessage')}
            type="text"
            value={s.handoffMessage}
            maxLength={AIAG_LIMITS.handoffMessage}
            disabled={disabled}
            placeholder={t('ackPlaceholder')}
            onChange={(e) => set({ handoffMessage: e.target.value })}
            className={cn(INPUT, 'border-border')}
          />
          <div className={HINT}>{t('ackHint')}</div>
        </div>
      </div>
    </div>
  );
}
