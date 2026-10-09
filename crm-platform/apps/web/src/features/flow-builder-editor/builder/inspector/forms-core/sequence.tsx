'use client';

import { useTranslations } from 'next-intl';
import { AddButton, RowCard, TextArea } from '../kit';
import { controlClass } from '../kit';
import type { FormProps } from '../types';
import { acceptFor, asArray, asRecord, moveItem, patchItem, str } from './helpers';
import { CardHeader, InfoBox, UploadBox, UploadedFile, uploadFile } from './parts';
import { SequencePreview } from './previews';

type Reply = Record<string, unknown>;
type ReplyKind = 'text' | 'image' | 'video' | 'audio' | 'document';

const TYPE_OPTS: ReplyKind[] = ['text', 'image', 'video', 'audio', 'document'];

export function SequenceForm({ data: d, set, env }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.sequence');
  const tp = useTranslations('flb.builder.formsCore.parts');
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
      <InfoBox>{t('info')}</InfoBox>
      {replies.map((r, i) => {
        const kind = (str(r.type) || 'text') as ReplyKind;
        // A saved reply of an unknown type is labelled like an image, as the file filter treats it.
        const labelKind = TYPE_OPTS.includes(kind) && kind !== 'text' ? kind : 'image';
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
                  <option key={o} value={o}>
                    {t(`kind.${o}`)}
                  </option>
                ))}
              </select>
            </CardHeader>
            <div className="space-y-2 p-3">
              {kind === 'text' ? (
                <TextArea
                  value={r.text}
                  rows={3}
                  placeholder={t('textPlaceholder')}
                  onChange={(v) => setReply(i, { text: v })}
                />
              ) : (
                <>
                  <UploadBox
                    compact
                    accept={acceptFor(kind, '.pdf,.doc,.docx,.xls,.xlsx,.txt')}
                    label={str(r.url) ? t(`replace.${labelKind}`) : t(`upload.${labelKind}`)}
                    onFile={(file) =>
                      uploadFile(tp, env, file, kind as 'image', (res) =>
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
                    placeholder={t('pasteUrl')}
                    className={`${controlClass} font-mono !text-[11.5px]`}
                  />
                  <input
                    type="text"
                    value={str(r.caption)}
                    onChange={(e) => setReply(i, { caption: e.target.value })}
                    placeholder={t('captionOptional')}
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
          <AddButton key={o} onClick={() => addReply(o)}>
            {t(`kind.${o}`)}
          </AddButton>
        ))}
      </div>
      {replies.length === 0 ? (
        <div className="mt-2 text-center text-[11.5px] italic text-muted-foreground">
          {t('empty')}
        </div>
      ) : null}
    </>
  );
}
