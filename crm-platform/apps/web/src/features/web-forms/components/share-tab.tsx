'use client';

import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, ConfirmDialog, Input, useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { formAction } from '../api/forms';
import { checkOrigin, qrTarget } from '../lib/share';
import type { FormDetail } from '../lib/types';
import type { BuilderTabProps } from './builder-types';
import { ChipEditor } from './settings-tab';

const MAX_ORIGINS = 20;
const PNG_SIZE = 1024;
const HINT = 'text-xs text-muted-foreground';
const LINK_BUTTON =
  'inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

export type RotateOutcome =
  { kind: 'ok'; form: FormDetail } | { kind: 'conflict' } | { kind: 'error' };

/** Rotating changes the public key, so a stale `rowVersion` must not slip through: a conflict is reported, never retried. */
export async function rotateKey(id: string, rowVersion: number): Promise<RotateOutcome> {
  try {
    return { kind: 'ok', form: await formAction(id, 'rotate-key', rowVersion) };
  } catch (e) {
    return e instanceof ApiError && e.isRowVersionConflict
      ? { kind: 'conflict' }
      : { kind: 'error' };
  }
}

/** Which notice the top of the tab shows: the public page exists only for a published form, and only while it is open. */
export function shareNotice(
  form: Pick<FormDetail, 'status' | 'publishedVersion'>,
): 'archived' | 'draft' | 'paused' | 'live' {
  if (form.status === 'archived') return 'archived';
  if (form.status === 'draft' || form.publishedVersion === null) return 'draft';
  if (form.status === 'paused') return 'paused';
  return 'live';
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Block({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card className="p-0">
      <section aria-labelledby={id} className="space-y-4 p-4 sm:p-5">
        <header className="space-y-1">
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          <p className={HINT}>{description}</p>
        </header>
        {children}
      </section>
    </Card>
  );
}

function CopyButton({
  text,
  label,
  copiedLabel,
}: {
  text: string;
  label: string;
  copiedLabel: string;
}) {
  const t = useTranslations('web-forms.share');
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        void writeClipboard(text).then((ok) => {
          if (!ok) {
            // A blocked clipboard (an insecure page, a denied permission) is not an error of ours: say how to carry on.
            toast(t('clipboardBlocked'), 'info');
            return;
          }
          toast(copiedLabel, 'success');
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? t('copied') : label}
    </Button>
  );
}

function Snippet({
  title,
  description,
  code,
  copyLabel,
}: {
  title: string;
  description: string;
  code: string;
  copyLabel: string;
}) {
  const t = useTranslations('web-forms.share');
  const id = useId();
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h3 id={id} className="text-sm font-medium">
            {title}
          </h3>
          <p className={HINT}>{description}</p>
        </div>
        <CopyButton
          text={code}
          label={copyLabel}
          copiedLabel={t('embed.copiedToast', { name: title })}
        />
      </div>
      <pre
        dir="ltr"
        tabIndex={0}
        aria-labelledby={id}
        className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted p-3 text-start text-xs text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** "Share": the public address, a QR code, the two embed snippets, the sites allowed to embed, and the key that makes all of it work. */
export function ShareTab(props: BuilderTabProps) {
  const { form, live, patchLive, onFormChange, canEdit } = props;
  const t = useTranslations('web-forms.share');
  const { toast } = useToast();
  const hostedId = useId();
  const qrRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);

  const notice = shareNotice(form);
  const hostedUrl = form.share.hostedUrl;
  const qrValue = qrTarget(hostedUrl);

  const download = (blob: Blob, ext: 'png' | 'svg') => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `form-${form.publicKey}-qr.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const serialiseQr = (): string | null => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg) return null;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(PNG_SIZE));
    clone.setAttribute('height', String(PNG_SIZE));
    return new XMLSerializer().serializeToString(clone);
  };

  const downloadSvg = () => {
    const text = serialiseQr();
    if (!text) return toast(t('qr.downloadFailed'), 'danger');
    download(new Blob([text], { type: 'image/svg+xml' }), 'svg');
  };

  const downloadPng = () => {
    const text = serialiseQr();
    if (!text) return toast(t('qr.downloadFailed'), 'danger');
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = PNG_SIZE;
      canvas.height = PNG_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) return toast(t('qr.downloadFailed'), 'danger');
      ctx.drawImage(img, 0, 0, PNG_SIZE, PNG_SIZE);
      canvas.toBlob((blob) => {
        if (blob) download(blob, 'png');
        else toast(t('qr.downloadFailed'), 'danger');
      }, 'image/png');
    };
    img.onerror = () => toast(t('qr.downloadFailed'), 'danger');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  };

  const confirmRotate = async () => {
    setRotating(true);
    const outcome = await rotateKey(form.id, form.rowVersion);
    setRotating(false);
    setConfirming(false);
    if (outcome.kind === 'ok') {
      onFormChange(outcome.form);
      toast(t('rotate.success'), 'success');
    } else {
      toast(outcome.kind === 'conflict' ? t('rotate.conflict') : t('rotate.failed'), 'danger');
    }
  };

  return (
    <div className="space-y-4">
      {!canEdit && <Alert tone="info">{t('readOnly')}</Alert>}
      <Alert tone={notice === 'live' ? 'success' : notice === 'draft' ? 'info' : 'warning'}>
        <p className="font-medium">{t(`status.${notice}.title`)}</p>
        <p className="text-xs">
          {notice === 'live'
            ? t('status.live.body', { version: form.publishedVersion ?? 0 })
            : t(`status.${notice}.body`)}
        </p>
      </Alert>

      <Block title={t('hosted.title')} description={t('hosted.description')}>
        <div className="space-y-1.5 text-sm">
          <label htmlFor={hostedId} className="block font-medium">
            {t('hosted.label')}
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={hostedId}
              readOnly
              dir="ltr"
              value={hostedUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 basis-60 text-start"
            />
            <CopyButton
              text={hostedUrl}
              label={t('hosted.copy')}
              copiedLabel={t('hosted.copiedToast')}
            />
            <a href={hostedUrl} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
              {t('hosted.open')}
              <span className="sr-only"> {t('hosted.newTab')}</span>
            </a>
          </div>
        </div>
      </Block>

      <Block title={t('qr.title')} description={t('qr.description')}>
        <div className="flex flex-wrap items-center gap-4">
          <div ref={qrRef} className="shrink-0 rounded-md border border-border bg-white p-1">
            <QRCodeSVG
              value={qrValue}
              size={176}
              level="M"
              marginSize={2}
              title={t('qr.alt')}
              bgColor="#ffffff"
              fgColor="#000000"
            />
          </div>
          <div className="min-w-0 space-y-2">
            <p className={HINT}>{t('qr.tracking')}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={downloadPng}>
                {t('qr.downloadPng')}
              </Button>
              <Button type="button" variant="secondary" onClick={downloadSvg}>
                {t('qr.downloadSvg')}
              </Button>
            </div>
          </div>
        </div>
      </Block>

      <Block title={t('embed.title')} description={t('embed.description')}>
        <Snippet
          title={t('embed.script.title')}
          description={t('embed.script.description')}
          code={form.share.scriptSnippet}
          copyLabel={t('embed.copy')}
        />
        <Snippet
          title={t('embed.iframe.title')}
          description={t('embed.iframe.description')}
          code={form.share.iframeSnippet}
          copyLabel={t('embed.copy')}
        />
      </Block>

      <Block title={t('domains.title')} description={t('domains.description')}>
        {live.allowedOrigins.length === 0 && <Alert tone="info">{t('domains.none')}</Alert>}
        <ChipEditor
          label={t('domains.label')}
          hint={t('domains.hint')}
          placeholder="https://www.example.com"
          values={live.allowedOrigins}
          countLabel={t('domains.count', { count: live.allowedOrigins.length, max: MAX_ORIGINS })}
          addLabel={t('domains.add')}
          removeLabel={(v) => t('domains.remove', { value: v })}
          emptyLabel={t('domains.empty')}
          disabled={!canEdit}
          ltr
          maxLength={200}
          onAdd={(raw) => {
            if (raw.trim() && live.allowedOrigins.length >= MAX_ORIGINS) {
              return t('domains.issues.max', { max: MAX_ORIGINS });
            }
            const r = checkOrigin(raw, live.allowedOrigins);
            if (!r.ok) return t(`domains.issues.${r.issue}`);
            patchLive({ allowedOrigins: [...live.allowedOrigins, r.value] });
            return null;
          }}
          onRemove={(v) =>
            patchLive({ allowedOrigins: live.allowedOrigins.filter((x) => x !== v) })
          }
        />
      </Block>

      <Block title={t('rotate.title')} description={t('rotate.description')}>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="danger"
            disabled={!canEdit || props.busy}
            onClick={() => setConfirming(true)}
          >
            {t('rotate.button')}
          </Button>
          {!canEdit && <Badge>{t('rotate.readOnly')}</Badge>}
        </div>
      </Block>

      <ConfirmDialog
        open={confirming}
        title={t('rotate.confirmTitle')}
        message={t('rotate.confirmMessage')}
        confirmLabel={t('rotate.confirmButton')}
        cancelLabel={t('rotate.cancel')}
        tone="danger"
        busy={rotating}
        onConfirm={() => void confirmRotate()}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
