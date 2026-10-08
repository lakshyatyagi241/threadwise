'use client';

import {
  OpenGenerativeUIActivityRenderer,
  OpenGenerativeUIActivityType,
  OpenGenerativeUIContentSchema,
  type OpenGenerativeUIContent,
  type ReactActivityMessageRenderer,
} from '@copilotkit/react-core/v2';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect } from 'react';
import { Button, Spinner } from '@crm/ui';
import { buildDesignedHtml, isDesignedReady, type DesignedContent } from '../lib/designed-report';

/** What the chat's card tells the page: "a designed report exists / changed" and "put it on show". */
export interface DesignedSink {
  upsert: (id: string, content: DesignedContent) => void;
  focus: (id: string) => void;
}
export const DesignedSinkContext = createContext<DesignedSink>({
  upsert: () => undefined,
  focus: () => undefined,
});

/**
 * The chat's view of a report the model designed. The page itself is not drawn here: it is handed to the Report panel (large, beside
 * the chat), and this card says what is happening and brings it into view.
 */
function DesignedChatCard({
  content,
  message,
}: {
  content: OpenGenerativeUIContent;
  message: { id: string };
}) {
  const t = useTranslations('report-copilot.designed');
  const sink = useContext(DesignedSinkContext);
  const { id } = message;
  // The content object is new on every render; the sink compares what is in it, so the same content again changes nothing.
  useEffect(() => {
    sink.upsert(id, content);
  }, [sink, id, content]);
  const ready = isDesignedReady(content);
  return (
    <div className="my-1 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <span className="flex items-center gap-2">
        {!ready && content.generating !== false && <Spinner />}
        {ready ? t('ready') : t('designing')}
      </span>
      <Button size="sm" variant="secondary" onClick={() => sink.focus(id)}>
        {t('show')}
      </Button>
    </div>
  );
}

/**
 * Registered on the provider (a stable module-level array). It is found before CopilotKit's own renderer for the same activity
 * type, so the sandboxed page is drawn once, in the Report panel, and not in the message list.
 */
export const DESIGNED_RENDERERS: ReactActivityMessageRenderer<OpenGenerativeUIContent>[] = [
  {
    activityType: OpenGenerativeUIActivityType,
    content: OpenGenerativeUIContentSchema,
    render: DesignedChatCard,
  },
];

/** Download the finished page as a standalone .html file. */
export function downloadDesignedHtml(html: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The designed report, large. CopilotKit's renderer puts it in an iframe with `sandbox="allow-scripts"` and no
 * `allow-same-origin`: the page has a null origin, so it cannot read this app's cookies, storage or DOM, and no sandbox function is
 * registered, so it has nothing to call. The white backing keeps a light page readable on a dark theme.
 */
export function DesignedCanvas({ id, content }: { id: string; content: DesignedContent }) {
  const t = useTranslations('report-copilot.designed');
  const html = buildDesignedHtml(content, t('fileTitle'));
  return (
    <div className="space-y-3" data-testid="designed-report">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!html}
          onClick={() => html && downloadDesignedHtml(html, 'report.html')}
        >
          {t('download')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {html ? t('exportNote') : t('designing')}
        </span>
      </div>
      <div
        className="overflow-hidden rounded-md border border-border"
        style={{ background: '#fff' }}
      >
        <OpenGenerativeUIActivityRenderer
          activityType={OpenGenerativeUIActivityType}
          content={content as OpenGenerativeUIContent}
          message={{
            id,
            role: 'activity',
            activityType: OpenGenerativeUIActivityType,
            content: {},
          }}
          agent={undefined}
        />
      </div>
    </div>
  );
}
