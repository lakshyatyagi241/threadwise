'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, Input, Select, Textarea, cn } from '@crm/ui';
import { OptOutLine, OptOutTemplateHint } from '@/features/contact-consent';
import type { AttributeCatalog, CampaignBuilder, ComposeTemplate } from '@crm/contracts';
import { OverridesPanel } from '@/features/broadcasts/components/overrides-panel';
import { UploadMediaButton } from '@/features/broadcasts/components/upload-media-button';
import { editorType, type BuilderForm, type ButtonRow } from '../../lib/builder-model';
import { SegmentCounter } from '@/features/channel-sms/components/segment-counter';
import { isLimitedEngine, isSmsEngine } from '../../lib/engine-gate';
import { PlusIcon, TrashIcon } from '../icons';
import { LabelRow, StepCard } from './parts';

type Attachment = 'none' | 'image' | 'video' | 'document';
const ATTACHMENTS: Attachment[] = ['none', 'image', 'video', 'document'];
const ACCEPT: Record<Exclude<Attachment, 'none'>, string> = {
  image: 'image/jpeg,image/png',
  video: 'video/mp4',
  document: '.pdf,.doc,.docx',
};
const MAX_BUTTONS = 3;
type ButtonMode = 'cta' | 'reply' | 'mix';

/** The kind of attachment an existing address looks like, so an edited campaign opens on the right choice. */
function attachmentOf(url: string): Attachment {
  const u = url.trim().toLowerCase().split('?')[0] ?? '';
  if (u === '') return 'none';
  if (/\.(mp4|3gp)$/.test(u)) return 'video';
  if (/\.(pdf|docx?)$/.test(u)) return 'document';
  return 'image';
}

function modeOf(buttons: ButtonRow[]): ButtonMode {
  const reply = buttons.filter((b) => b.type === 'quick_reply').length;
  if (reply === 0) return 'cta';
  return reply === buttons.length ? 'reply' : 'mix';
}

/**
 * Step 2 (TW-CAMP-005 to 007): what is sent. A custom message (header, body, attachment, footer, up to three buttons), an approved
 * template with this send's own variable values, or a flow started for every recipient. With A/B on, the second message, template or
 * flow goes to the other part of the audience.
 */
export function StepCompose({
  form,
  patch,
  builder,
  catalog,
  engine,
  templates,
}: {
  form: BuilderForm;
  patch: (p: Partial<BuilderForm>) => void;
  builder: CampaignBuilder | undefined;
  catalog: AttributeCatalog | undefined;
  /** The picked number's engine (waba, twilio, baileys, or empty when unknown). */
  engine: string;
  /** The templates that number can send. */
  templates: ComposeTemplate[];
}) {
  const t = useTranslations('campaigns.builder.compose');
  const sms = useTranslations('sms.compose');
  const kind = editorType(form.type);
  const limited = isLimitedEngine(engine);
  const text = isSmsEngine(engine);
  const approvedOnly =
    engine === 'waba' || (engine === '' && builder?.requiresApprovedTemplates === true);
  const flows = builder?.flows ?? [];
  const a = templates.find((x) => x.id === form.templateId);
  const b = templates.find((x) => x.id === form.templateIdB);
  const [attachment, setAttachment] = useState<Attachment>(() => attachmentOf(form.mediaUrl));
  const [mode, setMode] = useState<ButtonMode>(() => modeOf(form.buttons));

  const setButton = (i: number, row: Partial<ButtonRow>) =>
    patch({ buttons: form.buttons.map((x, j) => (j === i ? { ...x, ...row } : x)) });
  const pickMode = (m: ButtonMode) => {
    setMode(m);
    // Switching drops the rows the new mode cannot hold, as Reference's tabs do.
    patch({
      buttons: form.buttons.filter((x) =>
        m === 'cta' ? x.type !== 'quick_reply' : m === 'reply' ? x.type === 'quick_reply' : true,
      ),
    });
  };
  const addButton = () =>
    patch({
      buttons: [
        ...form.buttons,
        mode === 'reply'
          ? { type: 'quick_reply', text: '', value: '' }
          : { type: 'url', text: '', value: '' },
      ],
    });
  const types: ButtonRow['type'][] =
    mode === 'cta'
      ? ['url', 'copy_code', 'phone_number']
      : mode === 'reply'
        ? ['quick_reply']
        : ['url', 'copy_code', 'phone_number', 'quick_reply'];

  const picker = (
    id: string,
    value: string,
    onChange: (v: string) => void,
    options: Array<{ id: string; name: string }>,
    none: string,
  ) => (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{none}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </Select>
  );

  return (
    <StepCard index="02" title={t('title')} tag={t(`kind.${kind === 'text' ? 'custom' : kind}`)}>
      {(kind === 'text' || kind === 'custom') && (
        <>
          {limited && (
            <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[12px]">
              {text ? sms('note') : t(`engineNotes.${engine}`)}
            </p>
          )}
          {!text && (
            <div>
              <LabelRow note={t('headerNote')}>{t('header')}</LabelRow>
              <Input
                id="camp-header"
                aria-label={t('headerText')}
                maxLength={60}
                value={form.customHeader}
                onChange={(e) => patch({ customHeader: e.target.value })}
                placeholder={t('headerPlaceholder')}
              />
            </div>
          )}

          <div>
            <LabelRow note={t('required')}>{t('body')}</LabelRow>
            <Textarea
              id="camp-message"
              aria-label={t('body')}
              rows={8}
              maxLength={65000}
              value={form.customMessage}
              onChange={(e) => patch({ customMessage: e.target.value })}
              placeholder={t('bodyPlaceholder')}
            />
            {text ? (
              <>
                <SegmentCounter text={form.customMessage} />
                <p className="mt-1 text-[11px] text-muted-foreground">{sms('bodyHint')}</p>
              </>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">{t('bodyHint')}</p>
            )}
            <OptOutLine
              body={form.customMessage}
              onChange={(v) => patch({ customMessage: v })}
              idPrefix="camp-a"
            />
          </div>

          {form.abTesting && (
            <div>
              <LabelRow note={t('variantBNote')}>{t('variantB')}</LabelRow>
              <Textarea
                id="camp-message-b"
                aria-label={t('variantB')}
                rows={6}
                value={form.customMessageB}
                onChange={(e) => patch({ customMessageB: e.target.value })}
                placeholder={t('variantBPlaceholder')}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{t('variantBHint')}</p>
              <OptOutLine
                body={form.customMessageB}
                onChange={(v) => patch({ customMessageB: v })}
                idPrefix="camp-b"
              />
            </div>
          )}

          {!text && (
            <div className="rounded-xl border border-border p-3">
              <LabelRow note={t('attachmentNote')}>{t('attachment')}</LabelRow>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr]">
                <Field label={t('attachmentType')} htmlFor="camp-attach-type">
                  <Select
                    id="camp-attach-type"
                    value={attachment}
                    onChange={(e) => {
                      const next = e.target.value as Attachment;
                      setAttachment(next);
                      if (next === 'none') patch({ mediaUrl: '' });
                    }}
                  >
                    {ATTACHMENTS.map((k) => (
                      <option key={k} value={k}>
                        {t(`attachments.${k}.name`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {attachment === 'none' ? (
                  <p className="self-end pb-2 text-[12px] text-muted-foreground">
                    {t('noAttachment')}
                  </p>
                ) : (
                  <Field
                    label={t(`attachments.${attachment}.title`)}
                    htmlFor="camp-media"
                    hint={t(`attachments.${attachment}.hint`)}
                  >
                    <Input
                      id="camp-media"
                      type="url"
                      value={form.mediaUrl}
                      onChange={(e) => patch({ mediaUrl: e.target.value })}
                      placeholder="https://…"
                    />
                    <div className="mt-1.5">
                      <UploadMediaButton
                        accept={ACCEPT[attachment]}
                        onUploaded={(m) => patch({ mediaUrl: m.url })}
                      />
                    </div>
                  </Field>
                )}
              </div>
            </div>
          )}

          {!text && (
            <div>
              <LabelRow note={t('footerNote')}>{t('footer')}</LabelRow>
              <Input
                id="camp-footer"
                aria-label={t('footer')}
                maxLength={60}
                value={form.customFooter}
                onChange={(e) => patch({ customFooter: e.target.value })}
                placeholder={t('footerPlaceholder')}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{t('footerHint')}</p>
            </div>
          )}

          {limited ? null : (
            <div>
              <LabelRow note={t('buttonsNote')}>{t('buttons')}</LabelRow>
              <div
                role="tablist"
                aria-label={t('buttons')}
                className="mb-2 inline-flex rounded-full border border-border p-0.5"
              >
                {(['cta', 'reply', 'mix'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mode === m}
                    onClick={() => pickMode(m)}
                    className={cn(
                      'rounded-full px-3 py-1 text-[11.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      mode === m
                        ? 'bg-brand text-background'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {t(`modes.${m}`)}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                {form.buttons.map((row, i) => (
                  <div key={i} className="grid grid-cols-[130px_1fr_1fr_auto] items-center gap-2">
                    <Select
                      aria-label={t('buttonType')}
                      value={row.type}
                      onChange={(e) => setButton(i, { type: e.target.value as ButtonRow['type'] })}
                      className="text-xs"
                    >
                      {types.map((k) => (
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
                      onChange={(e) =>
                        setButton(
                          i,
                          row.type === 'quick_reply'
                            ? { text: e.target.value, value: e.target.value }
                            : { text: e.target.value },
                        )
                      }
                      className="text-xs"
                    />
                    {row.type === 'quick_reply' ? (
                      <span />
                    ) : (
                      <Input
                        aria-label={t('buttonValue')}
                        placeholder={
                          row.type === 'url'
                            ? 'https://…'
                            : row.type === 'copy_code'
                              ? 'PROMO50'
                              : t('buttonPhone')
                        }
                        value={row.value}
                        onChange={(e) => setButton(i, { value: e.target.value })}
                        className="text-xs"
                      />
                    )}
                    <button
                      type="button"
                      aria-label={t('removeButton')}
                      title={t('removeButton')}
                      className="grid size-8 place-items-center rounded-lg text-danger hover:bg-danger/10"
                      onClick={() => patch({ buttons: form.buttons.filter((_, j) => j !== i) })}
                    >
                      <TrashIcon className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              {form.buttons.length < MAX_BUTTONS && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mt-2 rounded-full"
                  onClick={addButton}
                >
                  <PlusIcon className="size-3" />
                  {mode === 'reply' ? t('addReply') : t('addCta')}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {kind === 'template' && (
        <>
          <p className="text-[12px] text-muted-foreground">
            {approvedOnly ? t('templateIntroApproved') : t('templateIntro')}
          </p>
          <OptOutTemplateHint />
          <Field
            label={`${approvedOnly ? t('templateApproved') : t('template')} *`}
            htmlFor="camp-template"
            hint={approvedOnly ? t('approvedOnly') : t('anyTemplate')}
          >
            {picker(
              'camp-template',
              form.templateId,
              (v) => patch({ templateId: v, templateOverrides: null }),
              templates,
              t('pickTemplate'),
            )}
          </Field>
          {templates.length === 0 && (
            <p className="text-[12px] text-muted-foreground">
              {engine === 'waba' || engine === 'twilio' || engine === 'baileys'
                ? t(`templateEmpty.${engine}`)
                : t('noTemplates')}{' '}
              <Link href="/templates/create" className="font-semibold text-brand hover:underline">
                {t('createTemplate')}
              </Link>
            </p>
          )}
          {a && (
            <>
              <div className="rounded-xl border border-border bg-muted/30 p-3 text-[12.5px]">
                <div className="font-semibold">{a.name}</div>
                <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{a.body}</div>
                {text && <SegmentCounter text={a.body} />}
              </div>
              <OverridesPanel
                key={a.id}
                template={a}
                catalog={catalog}
                onChange={(templateOverrides) => patch({ templateOverrides })}
              />
            </>
          )}
          {form.abTesting && (
            <>
              <Field
                label={t('variantBTemplate')}
                htmlFor="camp-template-b"
                hint={t('variantBTemplateHint')}
              >
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
        </>
      )}

      {kind === 'flow' && (
        <>
          <p className="text-[12px] text-muted-foreground">{t('flowIntro')}</p>
          <Field label={`${t('flow')} *`} htmlFor="camp-flow">
            {picker('camp-flow', form.flowId, (v) => patch({ flowId: v }), flows, t('pickFlow'))}
          </Field>
          {flows.length === 0 && (
            <p className="text-[12px] text-muted-foreground">
              {t('noFlows')}{' '}
              <Link href="/flows" className="font-semibold text-brand hover:underline">
                {t('createFlow')}
              </Link>
            </p>
          )}
          {form.abTesting && (
            <Field label={t('variantBFlow')} htmlFor="camp-flow-b" hint={t('variantBFlowHint')}>
              {picker(
                'camp-flow-b',
                form.flowIdB,
                (v) => patch({ flowIdB: v }),
                flows,
                t('sameFlow'),
              )}
            </Field>
          )}
        </>
      )}
    </StepCard>
  );
}
