'use client';

import { useContext, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FlowNode } from '@crm/contracts';
import { FLB_WA_LIMITS } from '@crm/contracts';
import { FlowEditorContext } from '../lib/flow-editor-context';
import { uploadFlowMedia } from '../lib/upload-media';
import { acceptFor } from './inspector/forms-core/helpers';
import { UploadBox } from './inspector/forms-core/parts';
import { PromptBox } from './ask-media/prompt-box';
import { FlowImage } from './flow-image';

/** The node types whose text is edited on the card: a message's text, a quick-reply list's labels, a media node's caption. */
export const INLINE_EDIT_TYPES: ReadonlySet<string> = new Set(['message', 'buttons', 'media']);

/** Stops a pointer or click in a field from starting a drag of the card, while the field keeps its own cursor and selection. */
const keepInField = (e: React.SyntheticEvent) => e.stopPropagation();

const FIELD =
  'w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] leading-snug text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * The editable body of a message, quick-reply or media card: the same data the inspector writes, changed in place. Each change goes
 * through `onPatch`, so it is saved with the flow like any other edit. Limits follow the WhatsApp rules when the flow is a WhatsApp one.
 */
export function InlineEditBody({
  node,
  onPatch,
}: {
  node: FlowNode;
  onPatch: (nodeId: string, patch: Record<string, unknown>) => void;
}) {
  const tf = useTranslations('flb.builder.formsCore.options');
  const { whatsapp } = useContext(FlowEditorContext);
  const data = node.data as Record<string, unknown>;

  if (node.type === 'message') {
    return (
      <div className="space-y-1 px-3 pb-3" onPointerDown={keepInField} onMouseDown={keepInField}>
        <PromptBox
          rows={3}
          maxLength={whatsapp ? FLB_WA_LIMITS.body : undefined}
          value={typeof data.text === 'string' ? data.text : ''}
          onChange={(text) => onPatch(node.id, { text })}
        />
      </div>
    );
  }

  if (node.type === 'buttons') {
    const options = Array.isArray(data.options)
      ? data.options.map((o) => (typeof o === 'string' ? o : ''))
      : [];
    return (
      <div className="space-y-1.5 px-3 pb-3" onPointerDown={keepInField} onMouseDown={keepInField}>
        {options.map((label, i) => (
          <input
            key={i}
            type="text"
            aria-label={`${tf('buttonsOptions')} ${i + 1}`}
            maxLength={whatsapp ? FLB_WA_LIMITS.buttonTitle : undefined}
            value={label}
            onChange={(e) => {
              const next = [...options];
              next[i] = e.target.value;
              onPatch(node.id, { options: next });
            }}
            className={FIELD}
          />
        ))}
      </div>
    );
  }

  return <MediaInlineBody node={node} onPatch={onPatch} />;
}

const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * The Send media card: the file is chosen or replaced here, on the card, without opening the node, and the caption is typed below it.
 * The upload is the one the inspector uses, and writes the same `url` and `filename`.
 */
function MediaInlineBody({
  node,
  onPatch,
}: {
  node: FlowNode;
  onPatch: (nodeId: string, patch: Record<string, unknown>) => void;
}) {
  const ts = useTranslations('flb.builder.simple.editors');
  const tsend = useTranslations('flb.builder.formsCore.send');
  const tp = useTranslations('flb.builder.formsCore.parts');
  const data = node.data as Record<string, unknown>;
  const kind: MediaKind = MEDIA_KINDS.includes(data.kind as MediaKind)
    ? (data.kind as MediaKind)
    : 'image';
  const url = typeof data.url === 'string' ? data.url : '';
  const filename = typeof data.filename === 'string' ? data.filename : '';
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const label = url ? tsend('replaceFile') : tsend(`chooseKind.${kind}`);

  const upload = (file: File) => {
    setBusy(true);
    setProblem(null);
    uploadFlowMedia(file, kind)
      .then((res) => onPatch(node.id, { url: res.url, filename: res.filename || file.name }))
      .catch((err: unknown) =>
        setProblem(
          tp('uploadFailed', { message: err instanceof Error ? err.message : String(err) }),
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-1.5 px-3 pb-3" onPointerDown={keepInField} onMouseDown={keepInField}>
      <div className={busy ? 'pointer-events-none opacity-60' : undefined}>
        <UploadBox
          accept={acceptFor(kind)}
          label={busy ? `${label}…` : label}
          compact
          onFile={upload}
        />
      </div>
      {url ? <MediaFilePreview kind={kind} url={url} filename={filename} /> : null}
      {url && filename ? (
        <div
          className="truncate font-mono text-[10.5px] text-muted-foreground"
          data-testid="media-card-file"
        >
          {filename}
        </div>
      ) : null}
      {problem ? (
        <div role="alert" className="text-[11px] text-[#E5484D]">
          {problem}
        </div>
      ) : null}
      <PromptBox
        rows={2}
        value={typeof data.caption === 'string' ? data.caption : ''}
        placeholder={ts('media.caption')}
        onChange={(caption) => onPatch(node.id, { caption })}
      />
    </div>
  );
}

/**
 * What the chosen file looks like, on the card itself, so a flow can be read at a glance without opening the node: a picture shows as a
 * picture, a video and a voice note as a player, a document as its name. A picture that cannot load says so (FlowImage).
 */
function MediaFilePreview({
  kind,
  url,
  filename,
}: {
  kind: MediaKind;
  url: string;
  filename: string;
}) {
  const tp = useTranslations('flb.builder.formsCore.previews');
  if (kind === 'image')
    return (
      <div data-testid="media-card-preview" data-kind="image">
        <FlowImage
          src={url}
          where="media card"
          className="block max-h-40 w-full rounded-md border border-border object-cover"
        />
      </div>
    );
  if (kind === 'video')
    return (
      <video
        src={url}
        controls
        preload="metadata"
        data-testid="media-card-preview"
        data-kind="video"
        className="block max-h-40 w-full rounded-md bg-black"
      />
    );
  if (kind === 'audio')
    return (
      <audio
        src={url}
        controls
        preload="metadata"
        data-testid="media-card-preview"
        data-kind="audio"
        className="block h-9 w-full"
      />
    );
  return (
    <div
      data-testid="media-card-preview"
      data-kind="document"
      className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand font-mono text-[9px] text-white">
        {(filename.split('.').pop() ?? 'FILE').slice(0, 4).toUpperCase() || 'FILE'}
      </span>
      <div className="min-w-0 flex-1 truncate text-[12px]">
        {filename || tp('documentFallback')}
      </div>
    </div>
  );
}
