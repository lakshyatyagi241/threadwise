'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, Input, Select, Textarea, cn } from '@crm/ui';
import type { AttributeCatalog, CampaignBuilder, CampaignType } from '@crm/contracts';
import { OverridesPanel } from '@/features/broadcasts/components/overrides-panel';
import { editorType, type BuilderForm, type ButtonRow } from '../lib/builder-model';
import { PlusIcon, TrashIcon } from './icons';

/** One numbered card of the builder, the frame Reference's create page uses for each step. */
export function Section({
  index,
  title,
  hint,
  children,
}: {
  index: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-5 py-4">
        <span className="inline-flex size-[23px] shrink-0 items-center justify-center rounded-[7px] bg-background font-mono text-[10px] font-semibold text-brand">
          {index}
        </span>
        <span className="flex-1 text-lg leading-none">{title}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

const TILES: Array<'text' | 'custom' | 'template' | 'flow'> = [
  'text',
  'custom',
  'template',
  'flow',
];
const BUTTON_TYPES: ButtonRow['type'][] = ['url', 'quick_reply', 'phone_number'];

/**
 * Step 2 of the builder (TW-CAMP-005 to 007): what is sent. A typed message (plain, or rich with a header, footer, media and
 * buttons), an approved template with this send's own variable values, or a flow. With A/B on, a second message, template or flow
 * is sent to the other part of the audience.
 */
export function MessageSection({
  form,
  patch,
  builder,
  catalog,
}: {
  form: BuilderForm;
  patch: (p: Partial<BuilderForm>) => void;
  builder: CampaignBuilder | undefined;
  catalog: AttributeCatalog | undefined;
}) {
  const t = useTranslations('campaigns.builder.message');
  const kind = editorType(form.type);
  const templates = builder?.templates ?? [];
  const a = templates.find((x) => x.id === form.templateId);
  const b = templates.find((x) => x.id === form.templateIdB);
  const flows = builder?.flows ?? [];

  const setButton = (i: number, row: Partial<ButtonRow>) =>
    patch({ buttons: form.buttons.map((x, j) => (j === i ? { ...x, ...row } : x)) });

  const picker = (
    id: string,
    value: string,
    onChange: (v: string) => void,
    options: Array<{ id: string; name: string }>,
    none: string,
  ) => (
    <Select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-[12.5px]"
    >
      <option value="">{none}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </Select>
  );

  return (
    <Section index="02" title={t('title')}>
      <div
        role="radiogroup"
        aria-label={t('type')}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {TILES.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => patch({ type: k as CampaignType })}
            className={cn(
              'rounded-xl border px-3 py-2.5 text-start transition hover:bg-muted',
              kind === k ? 'border-brand bg-brand/5' : 'border-border',
            )}
          >
            <div className="text-[12.5px] font-semibold">{t(`tiles.${k}.title`)}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{t(`tiles.${k}.hint`)}</div>
          </button>
        ))}
      </div>

      {(kind === 'text' || kind === 'custom') && (
        <>
          <Field label={`${t('message')} *`} htmlFor="camp-message" hint={t('messageHint')}>
            <Textarea
              id="camp-message"
              rows={6}
              maxLength={65000}
              value={form.customMessage}
              onChange={(e) => patch({ customMessage: e.target.value })}
              placeholder={t('messagePlaceholder')}
            />
          </Field>
          {kind === 'custom' && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t('header')} htmlFor="camp-header">
                  <Input
                    id="camp-header"
                    maxLength={255}
                    value={form.customHeader}
                    onChange={(e) => patch({ customHeader: e.target.value })}
                  />
                </Field>
                <Field label={t('footer')} htmlFor="camp-footer">
                  <Input
                    id="camp-footer"
                    maxLength={255}
                    value={form.customFooter}
                    onChange={(e) => patch({ customFooter: e.target.value })}
                  />
                </Field>
              </div>
              <Field label={t('media')} htmlFor="camp-media" hint={t('mediaHint')}>
                <Input
                  id="camp-media"
                  type="url"
                  value={form.mediaUrl}
                  onChange={(e) => patch({ mediaUrl: e.target.value })}
                  placeholder="https://…/promo.png"
                />
              </Field>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium">{t('buttons')}</span>
                  {form.buttons.length < 3 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="rounded-full"
                      onClick={() =>
                        patch({ buttons: [...form.buttons, { type: 'url', text: '', value: '' }] })
                      }
                    >
                      <PlusIcon className="size-3" />
                      {t('addButton')}
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {form.buttons.map((row, i) => (
                    <div key={i} className="grid grid-cols-[110px_1fr_1fr_auto] items-center gap-2">
                      <Select
                        aria-label={t('buttonType')}
                        value={row.type}
                        onChange={(e) =>
                          setButton(i, { type: e.target.value as ButtonRow['type'] })
                        }
                        className="text-xs"
                      >
                        {BUTTON_TYPES.map((k) => (
                          <option key={k} value={k}>
                            {t(`buttonTypes.${k}`)}
                          </option>
                        ))}
                      </Select>
                      <Input
                        aria-label={t('buttonText')}
                        placeholder={t('buttonText')}
                        value={row.text}
                        maxLength={25}
                        onChange={(e) => setButton(i, { text: e.target.value })}
                        className="text-xs"
                      />
                      <Input
                        aria-label={t('buttonValue')}
                        placeholder={
                          row.type === 'url'
                            ? 'https://…'
                            : row.type === 'phone_number'
                              ? '+91…'
                              : t('buttonReply')
                        }
                        value={row.value}
                        onChange={(e) => setButton(i, { value: e.target.value })}
                        className="text-xs"
                      />
                      <button
                        type="button"
                        aria-label={t('removeButton')}
                        className="grid size-8 place-items-center rounded-lg text-danger hover:bg-danger/10"
                        onClick={() => patch({ buttons: form.buttons.filter((_, j) => j !== i) })}
                      >
                        <TrashIcon className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {kind === 'template' && (
        <>
          <Field
            label={`${t('template')} *`}
            htmlFor="camp-template"
            hint={builder?.requiresApprovedTemplates ? t('approvedOnly') : undefined}
          >
            {picker(
              'camp-template',
              form.templateId,
              (v) => patch({ templateId: v, templateOverrides: null }),
              templates,
              t('pickTemplate'),
            )}
          </Field>
          {a && (
            <OverridesPanel
              key={a.id}
              template={a}
              catalog={catalog}
              onChange={(templateOverrides) => patch({ templateOverrides })}
            />
          )}
        </>
      )}

      {kind === 'flow' && (
        <Field label={`${t('flow')} *`} htmlFor="camp-flow" hint={t('flowHint')}>
          {picker('camp-flow', form.flowId, (v) => patch({ flowId: v }), flows, t('pickFlow'))}
        </Field>
      )}

      <div className="rounded-xl border border-border p-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={form.abTesting}
            onChange={(e) => patch({ abTesting: e.target.checked })}
          />
          {t('ab')}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">{t('abHint')}</p>
        {form.abTesting && (
          <div className="mt-3 space-y-3">
            <Field
              label={t('split', { a: form.abSplit, b: 100 - form.abSplit })}
              htmlFor="camp-split"
            >
              <input
                id="camp-split"
                type="range"
                min={0}
                max={100}
                step={5}
                value={form.abSplit}
                onChange={(e) => patch({ abSplit: Number(e.target.value) })}
                className="w-full accent-[var(--primary)]"
              />
            </Field>
            {(kind === 'text' || kind === 'custom') && (
              <Field label={t('messageB')} htmlFor="camp-message-b" hint={t('messageBHint')}>
                <Textarea
                  id="camp-message-b"
                  rows={4}
                  value={form.customMessageB}
                  onChange={(e) => patch({ customMessageB: e.target.value })}
                />
              </Field>
            )}
            {kind === 'template' && (
              <>
                <Field label={t('templateB')} htmlFor="camp-template-b" hint={t('templateBHint')}>
                  {picker(
                    'camp-template-b',
                    form.templateIdB,
                    (v) => patch({ templateIdB: v, templateOverridesB: null }),
                    templates,
                    t('sameTemplate'),
                  )}
                </Field>
                {b && b.id !== form.templateId && (
                  <OverridesPanel
                    key={b.id}
                    template={b}
                    catalog={catalog}
                    onChange={(templateOverridesB) => patch({ templateOverridesB })}
                  />
                )}
              </>
            )}
            {kind === 'flow' && (
              <Field label={t('flowB')} htmlFor="camp-flow-b">
                {picker(
                  'camp-flow-b',
                  form.flowIdB,
                  (v) => patch({ flowIdB: v }),
                  flows,
                  t('sameFlow'),
                )}
              </Field>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
