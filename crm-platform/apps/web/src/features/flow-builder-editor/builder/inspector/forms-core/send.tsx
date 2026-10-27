'use client';

import { useTranslations } from 'next-intl';
import { useContext, type ReactNode } from 'react';
import { FLB_WA_LIMITS } from '@crm/contracts';
import { FlowEditorContext } from '../../../lib/flow-editor-context';
import { Check, Field, Notice, SelectInput, TextArea, TextInput } from '../kit';
import type { FormProps } from '../types';
import { acceptFor, str, withCurrent } from './helpers';
import { InfoBox, Link, UploadBox, UploadedFile, uploadFile, V } from './parts';
import { RichTextField } from '../rich-text-field';
import { MediaPreview, MessagePreview, TemplatePreview } from './previews';

/** The media kinds the upload prompt names. */
const CHOOSE_KINDS = ['image', 'video', 'document', 'audio'];

const v = (chunks: ReactNode) => <V>{chunks}</V>;

export function MessageForm({ data: d, set, env }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.send');
  const { whatsapp } = useContext(FlowEditorContext);
  return (
    <>
      <MessagePreview d={d} />
      <Field label={t('messageLabel')} hint={t.rich('messageHint', { v })}>
        <RichTextField
          value={d.text}
          label={t('messageLabel')}
          placeholder={t('messagePlaceholder')}
          rows={6}
          max={whatsapp ? FLB_WA_LIMITS.text : undefined}
          nodes={env.nodes}
          onChange={(v) => set('text', v)}
        />
      </Field>
    </>
  );
}

export function TemplateForm({ data: d, set, setMany, env }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.send');
  const templates = env.ctx.templates;
  const opts = withCurrent(
    [
      { v: '', l: env.loading ? t('templateLoading') : t('templatePick') },
      ...templates.map((tpl) => ({
        v: tpl.name,
        l: tpl.name + (tpl.category ? ` · ${tpl.category}` : ''),
      })),
    ],
    d.tpl,
    (x) => t('notInWorkspace', { value: x }),
  );
  // Picking stamps both the name (what the runtime sends) and the template id, like Reference.
  const pick = (name: string) => {
    const hit = templates.find((tpl) => tpl.name === name);
    setMany({ tpl: name, tplId: hit ? hit.id : null, tplVars: {}, tplMedia: '' });
  };
  const chosen = templates.find((tpl) => tpl.name === str(d.tpl));
  const variables = chosen?.variables ?? [];
  const fills = (d.tplVars && typeof d.tplVars === 'object' ? d.tplVars : {}) as Record<
    string,
    string
  >;
  const setFill = (id: string, value: string) => {
    const next = { ...fills, [id]: value };
    if (value === '') delete next[id];
    set('tplVars', next);
  };
  // A header that is a picture, video or file needs a file to send: the template's own sample, or the one set here.
  const attachment = str(chosen?.attachmentType).toLowerCase();
  const needsMedia = ['image', 'photo', 'video', 'document'].includes(attachment);
  const mediaKind = attachment === 'photo' ? 'image' : attachment;
  const ownFile = /^https?:\/\//i.test(str(chosen?.attachmentFile))
    ? str(chosen?.attachmentFile)
    : '';
  const tp = useTranslations('flb.builder.formsCore.parts');
  return (
    <>
      <TemplatePreview d={d} templates={templates} />
      <Field
        label={t('templateLabel')}
        hint={t.rich('templateHint', {
          link: (chunks) => <Link href="/templates/create">{chunks}</Link>,
        })}
      >
        <SelectInput value={d.tpl} options={opts} onChange={pick} />
      </Field>
      {d.tplId ? (
        <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
          template_id = {str(d.tplId)}
        </div>
      ) : null}
      {variables.length > 0 ? (
        <Field label={t('templateFills')} hint={t('templateFillsHint')}>
          <div className="space-y-2">
            {variables.map((x) => {
              const id = `${x.section}:${x.slot}`;
              return (
                <div key={id} className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-[12.5px]">{`{{${x.slot}}}`}</span>
                  <div className="min-w-0 flex-1">
                    <TextInput
                      value={fills[id] ?? ''}
                      placeholder={x.field}
                      aria-label={`{{${x.slot}}}`}
                      onChange={(value) => setFill(id, value)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Field>
      ) : null}
      {needsMedia ? (
        <Field label={t('templateHeaderMedia')} hint={t('templateHeaderMediaHint')}>
          <UploadBox
            accept={acceptFor(mediaKind)}
            label={
              d.tplMedia
                ? t('replaceFile')
                : t(`chooseKind.${mediaKind === 'photo' ? 'image' : (mediaKind as 'image')}`)
            }
            onFile={(file) =>
              uploadFile(tp, env, file, mediaKind as 'image', (res) => set('tplMedia', res.url))
            }
          />
          <TextInput
            value={d.tplMedia}
            placeholder={ownFile || 'https://'}
            onChange={(value) => set('tplMedia', value)}
          />
          {!ownFile && !str(d.tplMedia).trim() ? (
            <p role="alert" className="mt-1 text-[12px] font-medium text-danger">
              {t('templateHeaderMediaMissing')}
            </p>
          ) : null}
        </Field>
      ) : null}
      <Field hint={t('statusExitsHint')}>
        <Check checked={d.statusExits === true} onChange={(on) => set('statusExits', on)}>
          {t('statusExits')}
        </Check>
      </Field>
    </>
  );
}

export function MediaForm({ data: d, set, setMany, env }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.send');
  const tp = useTranslations('flb.builder.formsCore.parts');
  const kind = str(d.kind) || 'image';
  const url = str(d.url);
  return (
    <>
      <MediaPreview d={d} />
      <Field label={t('type')}>
        <SelectInput
          value={d.kind}
          options={[
            { v: 'image', l: t('kindImage') },
            { v: 'video', l: t('kindVideo') },
            { v: 'document', l: t('kindDocument') },
            { v: 'audio', l: t('kindAudio') },
          ]}
          onChange={(v) => set('kind', v)}
        />
      </Field>
      <Field label={t('upload')} hint={t('uploadHint', { mb: 50 })}>
        <UploadBox
          accept={acceptFor(kind)}
          label={
            url ? t('replaceFile') : t(`chooseKind.${CHOOSE_KINDS.includes(kind) ? kind : 'image'}`)
          }
          onFile={(file) =>
            uploadFile(tp, env, file, kind as 'image', (res) =>
              setMany({ url: res.url, filename: res.filename }),
            )
          }
        />
        {url ? <UploadedFile kind={kind} url={url} filename={str(d.filename)} /> : null}
      </Field>
      <Field label={t('pasteUrl')}>
        <TextInput
          value={d.url}
          placeholder="https://example.com/image.jpg"
          onChange={(v) => set('url', v)}
        />
      </Field>
      <Field label={t('filename')}>
        <TextInput
          value={d.filename}
          placeholder="catalogue.pdf"
          onChange={(v) => set('filename', v)}
        />
      </Field>
      <Field label={t('caption')}>
        <RichTextField
          value={d.caption}
          label={t('caption')}
          placeholder={t('captionPlaceholder')}
          rows={3}
          nodes={env.nodes}
          onChange={(v) => set('caption', v)}
        />
      </Field>
    </>
  );
}

export function NotifyNumberForm({ data: d, set }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.send');
  const isMedia = !!d.kind && d.kind !== 'text';
  const src = d.source === 'custom' ? 'custom' : 'mirror';
  return (
    <>
      <Notice tone="info">{t.rich('notifyInfo', { b: (chunks) => <b>{chunks}</b> })}</Notice>
      <Field label={t('notifyNumber')} hint={t.rich('notifyNumberHint', { v })}>
        <TextInput
          value={d.copyNumber}
          placeholder="15551234567"
          onChange={(v) => set('copyNumber', v)}
        />
      </Field>
      <Field
        label={t('notifySource')}
        hint={src === 'mirror' ? t('notifySourceMirror') : t('notifySourceCustom')}
      >
        <SelectInput
          value={src}
          options={[
            { v: 'mirror', l: t('notifyMirror') },
            { v: 'custom', l: t('notifyCustom') },
          ]}
          onChange={(v) => set('source', v)}
        />
      </Field>
      {src === 'mirror' ? (
        <InfoBox className="text-foreground/70">{t('notifyMirrorInfo')}</InfoBox>
      ) : (
        <>
          <Field label={t('type')}>
            <SelectInput
              value={d.kind}
              options={[
                { v: 'text', l: t('kindText') },
                { v: 'image', l: t('kindImage') },
                { v: 'document', l: t('kindDocumentReport') },
                { v: 'video', l: t('kindVideo') },
                { v: 'audio', l: t('kindAudio') },
              ]}
              onChange={(v) => set('kind', v)}
            />
          </Field>
          {!isMedia ? (
            <Field label={t('notifyMessage')} hint={t('notifyMessageHint')}>
              <TextArea
                value={d.text}
                placeholder={t('notifyMessagePlaceholder')}
                onChange={(v) => set('text', v)}
              />
            </Field>
          ) : null}
          {isMedia ? (
            <Field label={t('notifyMediaUrl')} hint={t('notifyMediaUrlHint')}>
              <TextInput
                value={d.url}
                placeholder="https://example.com/report.pdf"
                onChange={(v) => set('url', v)}
              />
            </Field>
          ) : null}
          {isMedia ? (
            <Field label={t('filename')}>
              <TextInput
                value={d.filename}
                placeholder="report.pdf"
                onChange={(v) => set('filename', v)}
              />
            </Field>
          ) : null}
          {isMedia ? (
            <Field label={t('caption')}>
              <TextArea
                value={d.caption}
                placeholder={t('captionPlaceholder')}
                rows={3}
                onChange={(v) => set('caption', v)}
              />
            </Field>
          ) : null}
        </>
      )}
    </>
  );
}

export function WaToInstagramForm({ data: d, set }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.send');
  return (
    <>
      <Notice tone="ig">{t.rich('igInfo', { b: (chunks) => <b>{chunks}</b> })}</Notice>
      <Field label={t('igUsername')} hint={t('igUsernameHint')}>
        <TextInput
          value={d.igUsername}
          placeholder="yourbrand"
          onChange={(v) => set('igUsername', v)}
        />
      </Field>
      <Field label={t('igMessage')} hint={t('igMessageHint')}>
        <TextArea
          value={d.introText}
          placeholder={t('igMessagePlaceholder')}
          rows={2}
          onChange={(v) => set('introText', v)}
        />
      </Field>
    </>
  );
}
