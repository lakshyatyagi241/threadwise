'use client';

import { useTranslations } from 'next-intl';
import { useToast } from '@crm/ui';
import { uploadFlowMedia } from '../../lib/upload-media';
import { acceptFor } from '../inspector/forms-core/helpers';
import { UploadBox, UploadedFile } from '../inspector/forms-core/parts';

type Kind = 'image' | 'video' | 'audio' | 'document';

/**
 * "Choose a file" for the Simple builder's Media step and Carousel cards, next to the link field: uploads through the builder, hands the
 * link back, and shows a preview of whatever is set (picture, video, audio, or the file name) whether it was uploaded or pasted.
 */
export function MediaUpload({
  kind,
  url,
  filename,
  compact,
  onDone,
}: {
  kind: Kind;
  url: string;
  filename: string;
  compact?: boolean;
  onDone: (res: { url: string; filename: string }) => void;
}) {
  const t = useTranslations('flb.builder.formsCore.send');
  const tp = useTranslations('flb.builder.formsCore.parts');
  const { toast } = useToast();
  return (
    <div>
      <UploadBox
        compact={compact}
        accept={acceptFor(kind)}
        label={url ? t('replaceFile') : t(`chooseKind.${kind}`)}
        onFile={(file) => {
          uploadFlowMedia(file, kind)
            .then((res) => onDone({ url: res.url, filename: res.filename || file.name }))
            .catch((err: unknown) =>
              toast(
                tp('uploadFailed', { message: err instanceof Error ? err.message : String(err) }),
                'danger',
              ),
            );
        }}
      />
      {url ? (
        <UploadedFile kind={kind} url={url} filename={filename} size={compact ? 'sm' : 'md'} />
      ) : null}
    </div>
  );
}
