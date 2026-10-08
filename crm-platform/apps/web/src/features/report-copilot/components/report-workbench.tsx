'use client';

// CopilotKit 1.77 (v2 API). The styles are scoped to `[data-copilotkit]` and load with this chunk only.
import '@copilotkit/react-core/v2/styles.css';
import {
  CopilotChat,
  CopilotKitProvider,
  ToolCallStatus,
  useAgent,
  useAgentContext,
  useConfigureSuggestions,
  useCopilotKit,
  useFrontendTool,
} from '@copilotkit/react-core/v2';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useEffect,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  REPORT_DOCUMENT_EXTENSIONS,
  reportSpecSchema,
  type ReportScope,
  type ReportSpec,
  type ReportWindow,
} from '@crm/contracts';
import { Alert, Button, Drawer, Select, Spinner, cn } from '@crm/ui';
import { useAiModels } from '@/features/ai-keys-usage-admin';
import { runtimeUrl } from '../api/service';
import { useReportDocuments } from '../api/hooks';
import { AI_KEYS_HREF, uploadMenuAction } from '../lib/access';
import {
  activeItem,
  activeMeta,
  activeSpec,
  emptyCanvas,
  withActive,
  withDesigned,
  withDesignedActive,
  withBlock,
  withDrawn,
  type Canvas,
  type Drawn,
  type ReportMeta,
} from '../lib/canvas';
import type { Block } from '../lib/blocks';
import { blocksToMarkdown, reportFileName, reportToMarkdown } from '../lib/report-export';
import { REPORT_DESIGN_SKILL, type DesignedContent } from '../lib/designed-report';
import { turnOf } from '../lib/turn';
import { chatErrorDetail, chatErrorKind, type ChatErrorKind } from '../lib/errors';
import {
  RENDER_REPORT_ACTION,
  actionResult,
  parseReportSpec,
  readActionResult,
} from '../lib/render-report';
import { useBlockTools, type BlockContext } from './block-tools';
import { BlocksCanvas, LiveContext } from './report-blocks';
import { DESIGNED_RENDERERS, DesignedCanvas, DesignedSinkContext } from './designed-report';
import { DocumentsLibrary } from './documents-library';
import { UploadAttempts } from './upload-attempts';
import { useDocumentUploader } from './use-document-uploader';
import { ReportActions } from './report-actions';
import { ReportMetaBar } from './report-meta-bar';
import { ReportCanvas } from './report-canvas';
import { ReportPrint } from './report-print';

/** The first heading a report of blocks carries, for the list of earlier reports. */
const blocksTitle = (blocks: readonly Block[]): string => {
  for (const b of blocks) if (b.tool === 'show_summary' && b.data.title) return b.data.title;
  return '';
};

type Tab = 'chat' | 'report' | 'documents';

/** Lets the chat's tool card switch to the report pane (a phone shows one pane at a time). */
/** Module-level, so the provider sees stable props. No `sandboxFunctions`: the designed page gets nothing from the app to call. */
const OPEN_GENERATIVE_UI = { designSkill: REPORT_DESIGN_SKILL } as const;

const ShowReport = createContext<() => void>(() => undefined);

/** The card the chat shows for each `render_report` call: drawing, ready (with a way to see it) or could-not-draw. */
function RenderReportCard({
  status,
  args,
  result,
}: {
  status: ToolCallStatus;
  args: Partial<ReportSpec>;
  result: string | undefined;
}) {
  const t = useTranslations('report-copilot.tool');
  const show = useContext(ShowReport);
  if (status !== ToolCallStatus.Complete) {
    return (
      <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner /> {t('drawing')}
      </p>
    );
  }
  const view = readActionResult(result);
  if (view && !view.ok) {
    return (
      <Alert tone="warning" className="my-1">
        {t('failed')}
      </Alert>
    );
  }
  return (
    <div className="my-1 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <span>{t('ready', { title: view?.title ?? args.title ?? '' })}</span>
      <Button size="sm" variant="secondary" onClick={show}>
        {t('show')}
      </Button>
    </div>
  );
}

/**
 * Everything the assistant is told about and allowed to do, kept mounted for the life of the provider: the action that draws a
 * report, the page context, the suggested prompts.
 */
function Registrations({
  scope,
  win,
  onDrawn,
  onBlock,
}: {
  scope: ReportScope;
  win: ReportWindow;
  onDrawn: (d: Drawn, ctx: BlockContext) => void;
  onBlock: (block: Block, ctx: BlockContext) => void;
}) {
  const t = useTranslations('report-copilot.chat.suggestion');
  const locale = useLocale();
  const docs = useReportDocuments(scope);
  // The tools are registered once; they reach the current handlers through refs, so they never act on a stale render.
  const onBlockRef = useRef(onBlock);
  const onDrawnRef = useRef(onDrawn);
  useEffect(() => {
    onBlockRef.current = onBlock;
    onDrawnRef.current = onDrawn;
  });
  useBlockTools((block, ctx) => onBlockRef.current(block, ctx));

  useFrontendTool<ReportSpec>(
    {
      name: RENDER_REPORT_ACTION,
      description:
        'Draw one finished report in a single call. Prefer the show_summary, show_kpis, show_chart and show_table tools, which draw the report block by block; use this only when one complete report is wanted. ' +
        'Use only figures you actually read. Put the documents and figures you used in `sources`. If it answers with ok:false, fix the listed fields and call it again.',
      parameters: reportSpecSchema,
      handler: async (args, context) => {
        const outcome = parseReportSpec(args);
        onDrawnRef.current(
          outcome.ok ? { ok: true, spec: outcome.spec } : { ok: false, issues: outcome.issues },
          turnOf((context.agent as { messages?: never[] } | undefined)?.messages),
        );
        return actionResult(outcome);
      },
      render: RenderReportCard,
    },
    [],
  );

  useAgentContext({
    description:
      'The Reports page the person is on. `reportingWindow` is the period they chose for the numbers.',
    value: {
      scope,
      reportingWindow: win,
      libraryDocuments: docs.data?.data.length ?? 0,
      libraryDocumentNames: (docs.data?.data ?? [])
        .filter((d) => d.status === 'ready')
        .map((d) => d.name),
      today: new Date().toISOString().slice(0, 10),
    },
  });

  useConfigureSuggestions(
    {
      suggestions: (['summarise', 'performance', 'compare'] as const).map((k) => ({
        title: t(`${k}.title`),
        message: t(`${k}.message`),
      })),
      available: 'before-first-message',
    },
    [locale],
  );
  return null;
}

/** Shows when the workspace has no usable AI key at all, before the person types anything. */
function WorkspaceKeyHint() {
  const t = useTranslations('report-copilot.chat.keyRequired');
  const models = useAiModels();
  if (!models.data || models.data.data.length > 0) return null;
  return <KeyNotice text={t('workspace')} scope="workspace" />;
}

function KeyNotice({ text, scope }: { text: string; scope: ReportScope }) {
  const t = useTranslations('report-copilot.chat.keyRequired');
  return (
    <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-2">
      <span>{text}</span>
      <Link href={AI_KEYS_HREF[scope]} className="font-medium underline">
        {t('link')}
      </Link>
    </Alert>
  );
}

function TabButton({
  id,
  tab,
  set,
  className,
  children,
}: {
  id: Tab;
  tab: Tab;
  set: (t: Tab) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => set(id)}
      className={cn(
        'rounded px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary',
        tab === id
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface ReportWorkbenchProps {
  scope: ReportScope;
  canManage: boolean;
  /** The period the person chose for the numbers, told to the assistant as context. */
  win: ReportWindow;
}

/**
 * The page's body: CopilotKit chat on the left (full height), the report canvas on the right, and the document library in a side
 * drawer (a tab on a phone). Loaded on demand (next/dynamic, no SSR) by `ReportsPage`.
 */
export default function ReportWorkbench({ scope, canManage, win }: ReportWorkbenchProps) {
  const t = useTranslations('report-copilot');
  const [tab, setTab] = useState<Tab>('chat');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [canvas, setCanvas] = useState<Canvas>(emptyCanvas);
  const [chatError, setChatError] = useState<ChatErrorKind | null>(null);
  const [chatDetail, setChatDetail] = useState<string | null>(null);

  const library = useReportDocuments(scope);
  const readyDocs = (library.data?.data ?? []).filter((d) => d.status === 'ready').length;
  const readyDocsRef = useRef(readyDocs);
  useEffect(() => {
    readyDocsRef.current = readyDocs;
  }, [readyDocs]);
  const metaFor = (ctx: BlockContext): ReportMeta => ({
    prompt: ctx.prompt,
    generatedAt: Date.now(),
    documents: readyDocsRef.current,
  });
  const onDrawn = (d: Drawn, ctx: BlockContext) => {
    setCanvas((c) => withDrawn(c, d, metaFor(ctx)));
    setChatError(null);
    setChatDetail(null);
  };
  const onBlock = (block: Block, ctx: BlockContext) => {
    setCanvas((c) => withBlock(c, ctx.turn, block, metaFor(ctx)));
    setChatError(null);
    setChatDetail(null);
  };
  // "Refresh data": ask the same question again through the agent, so it reads the current documents and live numbers.
  const runner = useRef<(prompt: string) => Promise<void>>(async () => undefined);
  const [running, setRunning] = useState(false);
  const refresh = useCallback((prompt: string) => {
    setTab('chat');
    void runner.current(prompt);
  }, []);
  const spec = activeSpec(canvas);
  const current = activeItem(canvas);
  const printable =
    current?.kind === 'blocks' ? (
      <BlocksCanvas blocks={current.blocks} />
    ) : spec ? (
      <ReportCanvas spec={spec} />
    ) : null;
  const live = useMemo(() => ({ scope, window: win }), [scope, win]);
  // Files from the chat's "+" menu go to the library through the same hook as the Documents panel, never to the model as an attachment.
  const uploader = useDocumentUploader(scope, canManage);
  const picker = useRef<HTMLInputElement>(null);
  const [viewerNotice, setViewerNotice] = useState(false);
  const pickFiles = useCallback(() => {
    if (uploadMenuAction({ canRead: true, canManage }) === 'pick') picker.current?.click();
    else setViewerNotice(true);
  }, [canManage]);
  const chatInput = useMemo(() => ({ onAddFile: pickFiles }), [pickFiles]);
  const sink = useMemo(
    () => ({
      upsert: (id: string, content: DesignedContent) =>
        setCanvas((c) => withDesigned(c, id, content)),
      focus: (id: string) => {
        setCanvas((c) => withDesignedActive(c, id));
        setTab('report');
      },
    }),
    [],
  );

  return (
    <CopilotKitProvider
      runtimeUrl={runtimeUrl(scope)}
      credentials="same-origin"
      properties={{ scope, window: win }}
      enableInspector={false}
      renderActivityMessages={DESIGNED_RENDERERS}
      openGenerativeUI={OPEN_GENERATIVE_UI}
      onError={({ error }) => {
        setChatError(chatErrorKind(error));
        setChatDetail(chatErrorDetail(error));
      }}
    >
      <Registrations scope={scope} win={win} onDrawn={onDrawn} onBlock={onBlock} />
      <RunBridge runnerRef={runner} onRunning={setRunning} />
      <LiveContext.Provider value={live}>
        <DesignedSinkContext.Provider value={sink}>
          <ShowReport.Provider value={() => setTab('report')}>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div
                  role="tablist"
                  aria-label={t('panel.tabsLabel')}
                  className="inline-flex rounded-md border border-border p-0.5 lg:hidden"
                >
                  <TabButton id="chat" tab={tab} set={setTab}>
                    {t('panel.tab.chat')}
                  </TabButton>
                  <TabButton id="report" tab={tab} set={setTab}>
                    {t('panel.tab.report')}
                  </TabButton>
                  <TabButton id="documents" tab={tab} set={setTab}>
                    {t('panel.tab.documents')}
                  </TabButton>
                </div>
                <p className="hidden text-xs text-muted-foreground lg:block">
                  {t('page.sessionNote')}
                </p>
                <DocumentsButton
                  scope={scope}
                  onClick={() => setLibraryOpen(true)}
                  className="hidden lg:inline-flex"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(22rem,28rem)_minmax(0,1fr)] lg:items-start">
                <div
                  className={cn(
                    'min-w-0 space-y-3',
                    tab === 'report' && 'hidden lg:block',
                    tab === 'documents' && 'hidden lg:block',
                  )}
                >
                  {scope === 'workspace' && <WorkspaceKeyHint />}
                  {(chatError === 'keyRequired' || chatError === 'providerUnsupported') && (
                    <KeyNotice
                      text={t(
                        `chat.keyRequired.${chatError === 'keyRequired' ? scope : chatError}`,
                      )}
                      scope={scope}
                    />
                  )}
                  {chatError === 'generic' && (
                    <Alert tone="danger" className="flex items-center justify-between gap-2">
                      <span>{chatDetail ?? t('chat.error')}</span>
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setChatError(null)}
                      >
                        {t('documents.dismiss')}
                      </button>
                    </Alert>
                  )}
                  {viewerNotice && !canManage && (
                    <Alert tone="info" className="flex items-center justify-between gap-2">
                      <span>{t('documents.readOnly')}</span>
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setViewerNotice(false)}
                      >
                        {t('documents.dismiss')}
                      </button>
                    </Alert>
                  )}
                  <UploadAttempts
                    attempts={uploader.attempts}
                    scope={scope}
                    onDismiss={uploader.dismiss}
                    showDone
                  />
                  <input
                    ref={picker}
                    type="file"
                    multiple
                    accept={REPORT_DOCUMENT_EXTENSIONS.map((e) => `.${e}`).join(',')}
                    className="sr-only"
                    tabIndex={-1}
                    aria-label={t('chat.uploadMenu')}
                    data-testid="report-chat-file-input"
                    onChange={(e) => {
                      const files = [...(e.target.files ?? [])];
                      e.target.value = '';
                      uploader.clearFinished();
                      void uploader.add(files);
                    }}
                  />
                  <div
                    className="h-[32rem] overflow-hidden rounded-md border border-border lg:h-[calc(100dvh-13rem)] lg:min-h-[30rem]"
                    data-testid="report-chat"
                  >
                    <CopilotChat
                      input={chatInput}
                      labels={{
                        chatInputToolbarAddButtonLabel: t('chat.uploadMenu'),
                        chatInputPlaceholder: t('chat.placeholder'),
                        welcomeMessageText: t('chat.welcome'),
                        chatDisclaimerText: t('chat.disclaimer'),
                        modalHeaderTitle: t('chat.title'),
                      }}
                    />
                  </div>
                </div>

                <div
                  className={cn(
                    'min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto',
                    tab !== 'report' && 'hidden lg:block',
                  )}
                  data-testid="report-pane"
                >
                  <ReportPane
                    canvas={canvas}
                    running={running}
                    onRefresh={refresh}
                    onPick={(active) => setCanvas((c) => withActive(c, active))}
                  />
                </div>

                <div className={cn('min-w-0 lg:hidden', tab !== 'documents' && 'hidden')}>
                  <DocumentsLibrary scope={scope} canManage={canManage} uploader={uploader} />
                </div>
              </div>
            </div>

            <Drawer
              open={libraryOpen}
              onClose={() => setLibraryOpen(false)}
              title={t('documents.title')}
              closeLabel={t('panel.closeDocuments')}
            >
              <DocumentsLibrary scope={scope} canManage={canManage} uploader={uploader} />
            </Drawer>
            {printable && <ReportPrint>{printable}</ReportPrint>}
          </ShowReport.Provider>
        </DesignedSinkContext.Provider>
      </LiveContext.Provider>
    </CopilotKitProvider>
  );
}

/** "Documents (3)": opens the library. Reads the same cached list the library shows. */
function DocumentsButton({
  scope,
  onClick,
  className,
}: {
  scope: ReportScope;
  onClick: () => void;
  className?: string;
}) {
  const t = useTranslations('report-copilot.panel');
  const docs = useReportDocuments(scope);
  return (
    <Button variant="secondary" size="sm" className={className} onClick={onClick}>
      {t('documentsButton', { count: docs.data?.data.length ?? 0 })}
    </Button>
  );
}

/** Lives inside the provider, where the agent is reachable: gives the page a way to send a message and run the agent. */
function RunBridge({
  runnerRef,
  onRunning,
}: {
  runnerRef: { current: (prompt: string) => Promise<void> };
  onRunning: (running: boolean) => void;
}) {
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();
  useEffect(() => {
    runnerRef.current = async (prompt) => {
      agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: prompt });
      try {
        await copilotkit.runAgent({ agent });
      } catch (e) {
        console.error('Reports: refresh failed', e);
      }
    };
  }, [runnerRef, agent, copilotkit]);
  const isRunning = agent.isRunning;
  useEffect(() => onRunning(isRunning), [isRunning, onRunning]);
  return null;
}

function ReportPane({
  canvas,
  onPick,
  running,
  onRefresh,
}: {
  canvas: Canvas;
  onPick: (index: number) => void;
  running: boolean;
  onRefresh: (prompt: string) => void;
}) {
  const t = useTranslations('report-copilot.report');
  const item = activeItem(canvas);
  const meta = activeMeta(canvas);
  const tr = useTranslations('report-copilot.report');
  return (
    <div className="space-y-3">
      {canvas.issues && (
        <Alert tone="warning" className="space-y-2" data-testid="report-error">
          <p className="font-semibold">{t('error.title')}</p>
          <p>{t('error.message')}</p>
          {canvas.issues.length > 0 && (
            <details>
              <summary className="cursor-pointer">{t('error.details')}</summary>
              <ul className="mt-1 list-disc ps-5">
                {canvas.issues.map((i, k) => (
                  <li key={k}>{i}</li>
                ))}
              </ul>
            </details>
          )}
        </Alert>
      )}
      {item ? (
        <div className="space-y-4 rounded-md border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {item.kind === 'spec' ? (
              <ReportActions
                markdown={reportToMarkdown(item.spec, {
                  keyFigures: tr('keyFigures'),
                  sources: tr('sources'),
                })}
                json={item.spec}
                fileName={reportFileName(item.spec, 'json')}
              />
            ) : item.kind === 'blocks' ? (
              <ReportActions
                markdown={blocksToMarkdown(item.blocks, { source: tr('sources') })}
                json={item.blocks.map((b) => ({ block: b.tool, ...b.data }))}
                fileName="report.json"
              />
            ) : (
              <span />
            )}
            {canvas.items.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                {t('picker.label')}
                <Select
                  className="h-8 w-auto max-w-56 text-xs"
                  value={canvas.active}
                  onChange={(e) => onPick(Number(e.target.value))}
                >
                  {canvas.items.map((r, i) => (
                    <option key={i} value={i}>
                      {r.kind === 'spec'
                        ? t('picker.item', { n: i + 1, title: r.spec.title })
                        : r.kind === 'blocks'
                          ? blocksTitle(r.blocks)
                            ? t('picker.blocks', { n: i + 1, title: blocksTitle(r.blocks) })
                            : t('picker.untitled', { n: i + 1 })
                          : t('picker.designed', { n: i + 1 })}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </div>
          {meta && <ReportMetaBar meta={meta} running={running} onRefresh={onRefresh} />}
          {item.kind === 'spec' ? (
            <ReportCanvas spec={item.spec} />
          ) : item.kind === 'blocks' ? (
            <BlocksCanvas blocks={item.blocks} />
          ) : (
            <DesignedCanvas key={item.id} id={item.id} content={item.content} />
          )}
          <p className="border-t border-border pt-2 text-xs text-muted-foreground">
            {t('picker.note')}
          </p>
        </div>
      ) : (
        !canvas.issues && (
          <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
            <p className="font-semibold">{t('empty.title')}</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              {t('empty.message')}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">
              {t('picker.note')}
            </p>
          </div>
        )
      )}
    </div>
  );
}
