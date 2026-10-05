'use client';

import { AddButton, RowCard, TextArea } from '../kit';
import { controlClass } from '../kit';
import type { FormProps } from '../types';
import { acceptFor, asArray, asRecord, moveItem, patchItem, str } from './helpers';
import { CardHeader, InfoBox, UploadBox, UploadedFile, uploadFile } from './parts';
import { SequencePreview } from './previews';

type Reply = Record<string, unknown>;
type ReplyKind = 'text' | 'image' | 'video' | 'audio' | 'document';

const TYPE_OPTS: { v: ReplyKind; l: string }[] = [
  { v: 'text', l: 'Text' },
  { v: 'image', l: 'Image' },
  { v: 'video', l: 'Video' },
  { v: 'audio', l: 'Audio' },
  { v: 'document', l: 'Document' },
];

export function SequenceForm({ data: d, set, env }: FormProps) {
  const replies = asArray(d.replies).map(asRecord) as Reply[];
  const setReplies = (next: Reply[]) => set('replies', next);
  const setReply = (i: number, patch: Reply) => setReplies(patchItem(replies, i, patch));
  const addReply = (type: ReplyKind) =>
    setReplies([
      ...replies,
      type === 'text' ? { type: 'text', text: '' } : { type, url: '', filename: '', caption: '' },
    ]);

  return (
    <>
      <SequencePreview d={d} />
      <InfoBox>
        Each reply is sent in order to the customer. Combine text, images, video, audio, and
        documents in one node — perfect for product cards or onboarding kits.
      </InfoBox>
      {replies.map((r, i) => {
        const kind = (str(r.type) || 'text') as ReplyKind;
        return (
          <RowCard key={i}>
            <CardHeader
              index={i}
              isFirst={i === 0}
              isLast={i === replies.length - 1}
              onMove={(dir) => setReplies(moveItem(replies, i, dir))}
              onRemove={() => setReplies(replies.filter((_, j) => j !== i))}
            >
              <select
                value={kind}
                onChange={(e) => setReply(i, { type: e.target.value })}
                className="rounded border border-border bg-background px-2 py-1 text-[11.5px] outline-none focus:border-brand"
              >
                {TYPE_OPTS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
            </CardHeader>
            <div className="space-y-2 p-3">
              {kind === 'text' ? (
                <TextArea
                  value={r.text}
                  rows={3}
                  placeholder="Message text…"
                  onChange={(v) => setReply(i, { text: v })}
                />
              ) : (
                <>
                  <UploadBox
                    compact
                    accept={acceptFor(kind, '.pdf,.doc,.docx,.xls,.xlsx,.txt')}
                    label={str(r.url) ? `Replace ${kind}` : `Upload ${kind}`}
                    onFile={(file) =>
                      uploadFile(env, file, kind as 'image', (res) =>
                        setReply(i, { url: res.url, filename: res.filename }),
                      )
                    }
                  />
                  {str(r.url) ? (
                    <UploadedFile
                      kind={kind}
                      url={str(r.url)}
                      filename={str(r.filename)}
                      size="sm"
                    />
                  ) : null}
                  <input
                    type="text"
                    value={str(r.url)}
                    onChange={(e) => setReply(i, { url: e.target.value })}
                    placeholder="Or paste a URL"
                    className={`${controlClass} font-mono !text-[11.5px]`}
                  />
                  <input
                    type="text"
                    value={str(r.caption)}
                    onChange={(e) => setReply(i, { caption: e.target.value })}
                    placeholder="Caption (optional)"
                    className={controlClass}
                  />
                </>
              )}
            </div>
          </RowCard>
        );
      })}
      <div className="mt-1 flex flex-wrap gap-1.5">
        {TYPE_OPTS.map((o) => (
          <AddButton key={o.v} onClick={() => addReply(o.v)}>
            {o.l}
          </AddButton>
        ))}
      </div>
      {replies.length === 0 ? (
        <div className="mt-2 text-center text-[11.5px] italic text-muted-foreground">
          No replies yet — click a button above to add one.
        </div>
      ) : null}
    </>
  );
}
