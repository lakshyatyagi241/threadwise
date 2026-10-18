'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  flbFlowTypeOf,
  flbIsFlowType,
  type FlbAiGenerateResponse,
  type FlowDetail,
  type FlowGetaSync,
  type FlowType,
  type FlbPortContext,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useFlowWidget } from '@/features/chatbot-widget/api/widgets';
import { flowsApi } from '../api/flows';
import { useFlb, useMsg, type Msg } from '../lib/msg';
import { nodeLabel } from '../lib/contract-text';
import { validateGraph } from '../lib/validation-text';
import { getaApi } from '../geta-publish/api';
import { POLL_EVERY_MS, POLL_MAX_TRIES, viewOf } from '../geta-publish/status-model';
import { GetaPublishStatus } from '../geta-publish/sync-status';
import {
  BuilderTabs,
  WebBotPanels,
  useInitialTab,
  whatsappDefaultsFrom,
  type BuilderTab,
} from './web-bot-tabs';
import { FlowEditorContext } from '../lib/flow-editor-context';
import { FLB_KEYS, useBuilderContext } from '../api/hooks';
import {
  ZOOM_DEFAULT,
  addNode,
  addOption,
  canRedo,
  canUndo,
  connect,
  createHistory,
  deleteEdge,
  deleteNode,
  duplicateNode,
  NODE_W,
  pinStart,
  pushHistory,
  redo,
  removeOption,
  undo,
  updateData,
  type CanvasState,
  type History,
} from '../lib/graph-ops';
import { templateQuickReplies } from '../lib/templates';
import './builder.css';
import { BuilderFonts } from './builder-fonts';
import { Canvas } from './canvas';
import { InspectorPanel, Minimap, NodeActionBar, ValidationPopup } from './overlays';
import type { FormEnv } from './inspector/types';
import { AIGenModal, SaveConfirmModal } from './modals';
import { Icon } from './node-card';
import { Palette } from './palette';
import { QuickAddMenu } from './quick-add';
import { uploadFlowMedia } from '../lib/upload-media';
import { TestPanel } from './simulator/test-panel';
import { Toolbar } from './toolbar';

const NO_IDS: ReadonlySet<string> = new Set();
const DEFAULT_VARS = [
  { name: 'name', desc: 'Contact name', default: '' },
  { name: 'phone', desc: 'Phone number', default: '' },
];

/**
 * The builder is a full-screen layer over the app shell. Reference's builder page has no shell at all, so Tab never leaves the builder;
 * here the sidebar, header and banners sit under the layer, so they are taken out of the page (display none) while it is open: no
 * focus stops, no screen-reader reach, no layout change (the layer is fixed).
 */
function ShellHidden() {
  useEffect(() => {
    const root = document.querySelector('[data-testid="flow-builder"]');
    const hidden: Array<[HTMLElement, string]> = [];
    let node: Element | null = root;
    while (node && node.parentElement && node.parentElement !== document.body) {
      const parent: Element = node.parentElement;
      for (const sib of Array.from(parent.children)) {
        if (
          sib === node ||
          !(sib instanceof HTMLElement) ||
          sib.className.toString().includes('pointer-events-none')
        )
          continue;
        hidden.push([sib, sib.style.display]);
        sib.style.display = 'none';
      }
      node = parent;
    }
    return () => hidden.forEach(([e, d]) => (e.style.display = d));
  }, []);
  return null;
}

const errMessage = (e: unknown, fallback: string): string =>
  e instanceof ApiError ? e.message : ((e as Error)?.message ?? fallback);

/**
 * The builder (TW-FLB-014..019, 022): the whole screen, full viewport like Reference's (palette, canvas, inspector, toolbar,
 * test runner, AI generator). It holds the graph, the undo history and the save / publish lifecycle; the canvas, the forms
 * and the simulator are separate pieces. A new flow is `flowId = undefined` (the URL is replaced once the first save returns an id).
 */
export function BuilderScreen({ flowId: initialFlowId }: { flowId?: string }) {
  const params = useSearchParams();
  const flowQuery = useQuery({
    queryKey: initialFlowId ? FLB_KEYS.flow(initialFlowId) : ['flb', 'flow', 'new'],
    queryFn: ({ signal }) => flowsApi.get(initialFlowId!, signal),
    enabled: !!initialFlowId,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const { ctx, loading: ctxLoading, refresh } = useBuilderContext();
  const tb = useTranslations('flb.builder.shell.screen');

  // An unknown or out-of-workspace id gives a blank new-flow canvas (Reference: no 404), so a failed load is not an error screen.
  const ready = !ctxLoading && (!initialFlowId || !flowQuery.isPending);
  if (!ready) {
    return (
      <div className="flb-root fixed inset-0 z-40 grid place-items-center bg-background text-[13px] text-muted-foreground">
        <BuilderFonts />
        {tb('loading')}
      </div>
    );
  }
  return (
    <BuilderInner
      key={initialFlowId ?? 'new'}
      initial={flowQuery.data ?? null}
      ctx={ctx}
      refreshContext={refresh}
      typeParam={params.get('type')}
      aiOpenInitially={params.has('ai') || params.has('ai_prompt')}
      aiPrompt={params.get('ai_prompt') ?? ''}
      testOpenInitially={params.get('test') === '1'}
    />
  );
}

interface InnerProps {
  initial: FlowDetail | null;
  ctx: ReturnType<typeof useBuilderContext>['ctx'];
  refreshContext: () => void;
  typeParam: string | null;
  aiOpenInitially: boolean;
  aiPrompt: string;
  testOpenInitially: boolean;
}

function BuilderInner({
  initial,
  ctx,
  refreshContext,
  typeParam,
  aiOpenInitially,
  aiPrompt,
  testOpenInitially,
}: InnerProps) {
  const tb = useTranslations('flb.builder.shell.screen');
  const tw = useTranslations('flb.builder.webBot');
  const tf = useFlb();
  const seed = useMemo<CanvasState>(
    () => ({
      nodes: initial?.graph.flowNodes ?? [],
      edges: (initial?.graph.flowEdges ?? []).map((e) => ({
        ...e,
        kind: e.sourceHandle === 'no' ? ('no' as const) : null,
      })),
    }),
    [initial],
  );
  const [state, setState] = useState<CanvasState>(seed);
  const [hist, setHist] = useState<History>(() => createHistory(seed));
  const [name, setName] = useState(initial?.name ?? tb('newFlow'));
  const [flowId, setFlowId] = useState<string | null>(initial?.id ?? null);
  const [rowVersion, setRowVersion] = useState(initial?.rowVersion ?? 1);
  const [status, setStatus] = useState(initial?.isPublished ? 'Published' : 'Draft');
  const category = initial?.category ?? null;
  // Geta console publishing (an addition beyond Reference): the remote state of the last publish, polled while it is going live.
  const [published, setPublished] = useState(initial?.isPublished ?? false);
  const [geta, setGeta] = useState<FlowGetaSync | null>(initial?.getaSync ?? null);
  const [justPublished, setJustPublished] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const vars = useMemo(
    () => (initial?.graph.vars.length ? initial.graph.vars : DEFAULT_VARS),
    [initial],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [insOpen, setInsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !(typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767.98px)').matches),
  );
  const [query, setQuery] = useState('');
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  // The red outlines and the popup belong to the wiring they were computed for: any change to the edges clears them.
  const [vres, setVres] = useState<{
    edges: unknown;
    ids: ReadonlySet<string>;
    items: string[];
    popup: boolean;
  } | null>(null);
  const valid = vres !== null && vres.edges === state.edges ? vres : null;
  const invalid: ReadonlySet<string> = valid?.ids ?? NO_IDS;
  const validationItems = valid?.popup ? valid.items : null;
  const [saveOpen, setSaveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(aiOpenInitially);
  const [testOpen, setTestOpen] = useState(testOpenInitially);
  // QUIRK (Reference): `?test=1` opens the panel but does not start a run; only the Test button and Restart do.
  const [runNonce, setRunNonce] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewport, setViewport] = useState({ width: 1000, height: 600 });

  const m = useMsg();
  const toast = useCallback(
    (text: string | Msg) => {
      setToastMsg(typeof text === 'string' ? text : m(text));
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToastMsg(null), 1800);
    },
    [m],
  );
  useEffect(() => () => void (toastTimer.current && clearTimeout(toastTimer.current)), []);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setViewport({ width: el.clientWidth, height: el.clientHeight }),
    );
    ro.observe(el);
    setViewport({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // The channel the flow was opened as: a call flow stays call; a messaging channel only if this workspace can run it. The link's
  // `?type=` is read once: the first save rewrites the address to the saved flow's, and the channel must not follow that.
  const [openedType] = useState(typeParam);
  const openedAs: FlowType = useMemo(() => {
    const t = initial?.flowType ?? (flbIsFlowType(openedType) ? openedType : 'chat');
    if (t === 'call' || t === 'web') return t;
    return ctx.channels.includes(t) ? t : 'chat';
  }, [initial, openedType, ctx.channels]);
  const mode = flbFlowTypeOf(state.nodes, openedAs, ctx.channels);
  // A website chat or WhatsApp bot has Customize and Deploy beside the canvas; the other channels only build.
  const widgetChannel: 'web' | 'chat' | null =
    mode === 'web' ? 'web' : mode === 'chat' ? 'chat' : null;
  const initialTab = useInitialTab(!!initial);
  const [tab, setTab] = useState<BuilderTab>(initialTab);
  // Another channel has no tabs, whatever the link asked for.
  const shownTab: BuilderTab = widgetChannel ? tab : 'build';
  const canEditFlow = useCan('flb.flows.update');
  const widgetQuery = useFlowWidget(widgetChannel ? flowId : null);
  const needsCustomizing = !!widgetChannel && !!flowId && widgetQuery.data?.widget === null;
  const portCtx = useMemo<FlbPortContext>(
    () => ({ templateButtons: (node) => templateQuickReplies(ctx.templates, node) }),
    [ctx.templates],
  );

  // --- state changes ----------------------------------------------------------------------------------------------------
  const markDirty = useCallback(() => setStatus('Draft · unsaved'), []);
  const commit = useCallback(
    (next: CanvasState) => {
      setState(next);
      setHist((h) => pushHistory(h, next));
      markDirty();
    },
    [markDirty],
  );
  const live = useCallback((next: CanvasState) => setState(next), []);

  const selectedNode = useMemo(
    () => state.nodes.find((n) => n.id === selectedId) ?? null,
    [state.nodes, selectedId],
  );

  const doUndo = useCallback(() => {
    const r = undo(hist);
    if (!r) return;
    setHist(r.history);
    setState(r.state);
  }, [hist]);
  const doRedo = useCallback(() => {
    const r = redo(hist);
    if (!r) return;
    setHist(r.history);
    setState(r.state);
  }, [hist]);

  const [quickAdd, setQuickAdd] = useState<{
    from: { nodeId: string; handleId: string };
    world: { x: number; y: number };
    screen: { x: number; y: number };
  } | null>(null);

  const doAdd = useCallback(
    (type: string, x: number, y: number) => {
      const r = addNode(state, type, x, y);
      if (!r.ok) return toast(r.message);
      commit(r.state);
      setSelectedId(r.id ?? null);
    },
    [state, commit, toast],
  );
  const quickAddPick = useCallback(
    (type: string) => {
      if (!quickAdd) return;
      const r = addNode(state, type, quickAdd.world.x, quickAdd.world.y - 30);
      if (!r.ok) {
        toast(r.message);
        return;
      }
      commit(r.id ? connect(r.state, quickAdd.from, r.id) : r.state);
      setSelectedId(r.id ?? null);
      setQuickAdd(null);
    },
    [quickAdd, state, commit, toast],
  );
  const addAtCenter = useCallback(
    (type: string) => {
      const el = wrapperRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      doAdd(type, (r.width / 2 - pan.x) / zoom - NODE_W / 2, (r.height / 2 - pan.y) / zoom - 60);
      // On touch the palette is a full-height drawer: close it after a tap-add so the new node is visible.
      if (window.matchMedia?.('(pointer: coarse)').matches) setSidebarOpen(false);
    },
    [doAdd, pan, zoom],
  );
  const doDelete = useCallback(
    (id: string) => {
      commit(deleteNode(state, id));
      if (selectedId === id) setSelectedId(null);
    },
    [state, commit, selectedId],
  );
  const doDuplicate = useCallback(
    (id: string) => {
      const r = duplicateNode(state, id);
      if (!r.ok) return toast(r.message);
      commit(r.state);
      setSelectedId(r.id ?? null);
    },
    [state, commit, toast],
  );

  // Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Y or Shift+Z redo, Ctrl/Cmd+D duplicate, Backspace/Delete delete, Escape clears.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable
      )
        return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if (mod && (k === 'y' || (e.shiftKey && k === 'z'))) {
        e.preventDefault();
        doRedo();
      } else if (mod && k === 'd' && selectedId) {
        e.preventDefault();
        doDuplicate(selectedId);
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId) {
        e.preventDefault();
        doDelete(selectedId);
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [doUndo, doRedo, doDuplicate, doDelete, selectedId]);

  // --- save / publish -----------------------------------------------------------------------------------------------------
  const senderAvailable = useMemo(() => {
    if (mode === 'instagram') return ctx.senders.instagram.length > 0;
    if (mode === 'facebook') return ctx.senders.facebook.length > 0;
    return ctx.senders.chat.length > 0;
  }, [mode, ctx.senders]);

  /** Select a node and bring it to the middle of the canvas. */
  const focusNode = (id: string) => {
    const n = state.nodes.find((x) => x.id === id);
    const el = wrapperRef.current;
    setSelectedId(id);
    if (!n || !el) return;
    const r = el.getBoundingClientRect();
    setPan({ x: r.width / 2 - (n.x + NODE_W / 2) * zoom, y: r.height / 2 - (n.y + 60) * zoom });
  };

  const runValidation = (): boolean => {
    const r = validateGraph(state.nodes, state.edges, { mode, senderAvailable });
    if (r.ok) {
      setVres(null);
      return true;
    }
    setVres({ edges: state.edges, ids: new Set(r.badNodeIds), items: r.items.map(m), popup: true });
    if (r.badNodeIds[0]) focusNode(r.badNodeIds[0]);
    return false;
  };

  const payload = (flowName: string) => ({
    name: flowName,
    category,
    flowType: mode,
    graph: {
      flowNodes: state.nodes as unknown as Array<Record<string, unknown>>,
      flowEdges: state.edges.map(({ id, source, sourceHandle, target }) => ({
        id,
        source,
        sourceHandle,
        target,
      })),
      vars: vars as unknown as Array<Record<string, unknown>>,
    },
  });

  /** Create or update, whichever the flow needs. Returns the saved flow so publish can use its id and version. */
  const persist = async (flowName: string): Promise<FlowDetail> => {
    const saved = flowId
      ? await flowsApi.save(flowId, { ...payload(flowName), rowVersion })
      : await flowsApi.create(payload(flowName));
    if (!flowId) {
      setFlowId(saved.id);
      window.history.replaceState({}, '', `/flows/builder/${saved.id}`);
    }
    setRowVersion(saved.rowVersion);
    setName(saved.name);
    return saved;
  };

  const saveFlow = async (flowName: string) => {
    if (busy) return;
    const statusAtClick = status;
    setBusy(true);
    try {
      setStatus('Saving...');
      const saved = await persist(flowName);
      // QUIRK kept from Reference: the pill keeps "Published" only when the click happened with nothing edited; saving edits
      // to a live flow reads "Draft" although the flow stays live on the server (the next Save republishes silently).
      setStatus(statusAtClick === 'Published' ? 'Published' : 'Draft');
      toast(tb('flowSaved', { name: saved.name }));
      setSaveOpen(false);
    } catch (e) {
      setStatus('Draft · unsaved');
      toast(tb('saveFailed', { message: errMessage(e, tb('unknownError')) }));
    } finally {
      setBusy(false);
    }
  };

  const onSave = () => {
    if (!runValidation()) return;
    if (flowId && name.trim()) void saveFlow(name.trim());
    else setSaveOpen(true);
  };

  // While the push is pending, ask the server how it went (the worker makes the calls; the publish itself already succeeded).
  useEffect(() => {
    if (!flowId || geta?.state !== 'pending') return;
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      tries++;
      try {
        const next = await getaApi.status(flowId);
        if (stopped) return;
        setGeta(next);
        if (next.state !== 'pending') return;
      } catch {
        // a failed poll is not a failed push: ask again
      }
      if (tries < POLL_MAX_TRIES && !stopped) timer = setTimeout(() => void tick(), POLL_EVERY_MS);
    };
    timer = setTimeout(() => void tick(), POLL_EVERY_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [flowId, geta?.state]);

  const onGetaRetry = async () => {
    if (!flowId || retrying) return;
    setRetrying(true);
    try {
      setGeta(await getaApi.retry(flowId));
    } catch (e) {
      toast(tb('retryFailed', { message: errMessage(e, tb('unknownError')) }));
    } finally {
      setRetrying(false);
    }
  };

  const onPublish = async () => {
    if (!runValidation() || busy) return;
    setBusy(true);
    try {
      let id = flowId;
      if (!id) {
        // A never-saved graph is saved once and THAT row is published (Reference saved twice and published a second copy).
        const saved = await persist(name.trim() || tb('newFlow'));
        id = saved.id;
      }
      if (widgetChannel) {
        // A bot goes live with the widget its owner chose (the chat window, or the WhatsApp button), so Customize has to be saved once first.
        const widget = !flowId
          ? null
          : ((widgetQuery.data ?? (await widgetQuery.refetch()).data)?.widget ?? null);
        if (!widget) {
          setTab('customize');
          toast(tw(widgetChannel === 'web' ? 'customizeFirst' : 'customizeFirstWhatsapp'));
          return;
        }
      }
      const pub = await flowsApi.publish(id);
      setRowVersion(pub.rowVersion);
      setStatus('Published');
      setPublished(true);
      setJustPublished(true);
      setGeta(pub.getaSync ?? null);
      toast(tb('published'));
    } catch (e) {
      toast(tb('publishFailed', { message: errMessage(e, tb('unknownError')) }));
    } finally {
      setBusy(false);
    }
  };

  const applyGenerated = (flow: FlbAiGenerateResponse['flow'], modelLabel: string) => {
    const next: CanvasState = {
      nodes: flow.flowNodes,
      edges: flow.flowEdges.map((e) => ({
        ...e,
        kind: e.sourceHandle === 'no' ? ('no' as const) : null,
      })),
    };
    setState(next);
    setHist((h) => pushHistory(h, next));
    setSelectedId(null);
    setStatus('Draft · unsaved (AI-generated)');
    toast(tb('generated', { model: modelLabel }));
  };

  const env: FormEnv = useMemo(
    () => ({
      ctx,
      loading: false,
      mode,
      openedAs,
      channels: ctx.channels,
      refresh: refreshContext,
      toast,
      nodes: state.nodes,
      flowId,
      uploadMedia: uploadFlowMedia,
    }),
    [ctx, mode, openedAs, refreshContext, toast, state.nodes, flowId],
  );

  return (
    <FlowEditorContext.Provider
      value={{ flowId, web: mode === 'web', channel: mode, whatsapp: mode === 'chat' }}
    >
      <div
        className="flb-root fixed inset-0 z-40 flex flex-col bg-background text-foreground"
        data-testid="flow-builder"
      >
        <BuilderFonts />
        <ShellHidden />
        <Toolbar
          flowId={flowId}
          flowName={name}
          setFlowName={(v) => {
            setName(v);
            markDirty();
          }}
          status={status}
          busy={busy}
          onSave={onSave}
          onPublish={() => void onPublish()}
          onTest={() => {
            setTestOpen(true);
            setRunNonce((n) => n + 1);
          }}
          onAIGen={() => setAiOpen(true)}
          remoteStatus={
            <GetaPublishStatus
              view={viewOf(geta, { published, justPublished })}
              retrying={retrying}
              onRetry={() => void onGetaRetry()}
            />
          }
        />

        {widgetChannel ? (
          // The Advanced builder has no FAQs tab: a flow's FAQs are edited in the Simple builder.
          <BuilderTabs
            tab={shownTab}
            onTab={setTab}
            saved={!!flowId}
            needsCustomizing={needsCustomizing}
            faqs={false}
            web
          />
        ) : null}

        <div className={`relative flex min-h-0 flex-1 ${shownTab === 'build' ? '' : 'hidden'}`}>
          {sidebarOpen ? (
            <>
              <Palette mode={mode} query={query} onSearch={setQuery} onAddCenter={addAtCenter} />
              <div className="flow-palette-backdrop" onClick={() => setSidebarOpen(false)} />
            </>
          ) : null}

          <Canvas
            state={state}
            ctx={ctx}
            portCtx={portCtx}
            selectedId={selectedId}
            invalidIds={invalid}
            pan={pan}
            zoom={zoom}
            setPan={setPan}
            setZoom={setZoom}
            onSelect={setSelectedId}
            onOpenNode={(id) => {
              setSelectedId(id);
              setInsOpen(true);
            }}
            onLive={live}
            onMoved={(next) => {
              setHist((h) => pushHistory(h, next));
              markDirty();
            }}
            onConnect={(from, target) => {
              // A self connection is ignored: no history entry, no "unsaved".
              const next = connect(state, from, target);
              if (next !== state) commit(next);
            }}
            onDropNode={doAdd}
            onDropEmpty={(from, world, screen) => setQuickAdd({ from, world, screen })}
            onDeleteEdge={(id) => commit(deleteEdge(state, id))}
            onPatchNode={(id, patch) => commit(updateData(state, id, patch))}
            wrapperRef={wrapperRef}
          >
            {quickAdd ? (
              <QuickAddMenu
                mode={mode}
                x={quickAdd.screen.x}
                y={quickAdd.screen.y}
                onPick={quickAddPick}
                onClose={() => setQuickAdd(null)}
              />
            ) : null}

            {selectedNode ? (
              <NodeActionBar
                node={selectedNode}
                pan={pan}
                zoom={zoom}
                onEdit={() => setInsOpen(true)}
                onDelete={() => doDelete(selectedNode.id)}
                onDuplicate={() => doDuplicate(selectedNode.id)}
                onPin={() => commit(pinStart(state, selectedNode.id))}
              />
            ) : null}

            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="absolute top-1/2 start-0 z-20 grid h-12 w-5 -translate-y-1/2 place-items-center rounded-e-md border border-s-0 border-border bg-background hover:bg-muted"
              title={sidebarOpen ? tb('hideSidebar') : tb('showSidebar')}
              aria-label={sidebarOpen ? tb('hideSidebar') : tb('showSidebar')}
            >
              <Icon
                d={sidebarOpen ? 'M9 4l-3 4 3 4' : 'M7 4l3 4-3 4'}
                className="h-3 w-3 text-muted-foreground"
              />
            </button>

            {!sidebarOpen ? (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="absolute bottom-4 start-4 z-30 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-[13px] font-semibold text-brand-foreground shadow-lg md:hidden"
                title={tb('addNodeTitle')}
              >
                <Icon d="M8 3v10M3 8h10" />
                {tb('addNode')}
              </button>
            ) : null}

            <Minimap
              nodes={state.nodes}
              pan={pan}
              zoom={zoom}
              setPan={setPan}
              viewport={viewport}
            />

            <div className="absolute end-4 bottom-4 z-20 flex items-center gap-2">
              <div className="flex items-center overflow-hidden rounded-full border border-border bg-background/95 shadow">
                <button
                  type="button"
                  onClick={doUndo}
                  disabled={!canUndo(hist)}
                  className="grid h-9 w-9 place-items-center hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  title={tb('undoTitle')}
                  aria-label={tb('undo')}
                >
                  <Icon d="M4 8h6a3 3 0 0 1 0 6M4 8l3-3M4 8l3 3" className="h-3.5 w-3.5" />
                </button>
                <div className="h-5 w-px bg-border" />
                <button
                  type="button"
                  onClick={doRedo}
                  disabled={!canRedo(hist)}
                  className="grid h-9 w-9 place-items-center hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  title={tb('redoTitle')}
                  aria-label={tb('redo')}
                >
                  <Icon d="M12 8H6a3 3 0 0 0 0 6M12 8L9 5M12 8l-3 3" className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center overflow-hidden rounded-full border border-border bg-background/95 shadow">
                <button
                  type="button"
                  onClick={() => setZoom(Math.min(1.8, zoom + 0.1))}
                  className="grid h-9 w-9 place-items-center hover:bg-muted"
                  title={tb('zoomIn')}
                  aria-label={tb('zoomIn')}
                >
                  <Icon d="M8 4v8M4 8h8" className="h-3.5 w-3.5" />
                </button>
                <div
                  className="grid h-9 min-w-[44px] place-items-center border-x border-border px-2 text-center font-mono text-[10.5px] text-foreground/70"
                  data-testid="zoom-level"
                >
                  {Math.round(zoom * 100)}%
                </div>
                <button
                  type="button"
                  onClick={() => setZoom(Math.max(0.4, zoom - 0.1))}
                  className="grid h-9 w-9 place-items-center hover:bg-muted"
                  title={tb('zoomOut')}
                  aria-label={tb('zoomOut')}
                >
                  <Icon d="M4 8h8" className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 40, y: 40 });
                  }}
                  className="grid h-9 w-9 place-items-center border-s border-border hover:bg-muted"
                  title={tb('reset')}
                  aria-label={tb('resetView')}
                >
                  <Icon d="M3 8a5 5 0 1 0 1.5-3.5L3 6M3 3v3h3" className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </Canvas>

          <InspectorPanel
            node={selectedNode}
            open={insOpen}
            env={env}
            onClose={() => setInsOpen(false)}
            onDelete={() => selectedNode && doDelete(selectedNode.id)}
            onSet={(k, v) => selectedNode && commit(updateData(state, selectedNode.id, { [k]: v }))}
            onSetMany={(patch) => selectedNode && commit(updateData(state, selectedNode.id, patch))}
            onAddOption={() => {
              if (!selectedNode) return;
              const r = addOption(state, selectedNode.id);
              if (!r.ok) return toast(r.message);
              commit(r.state);
            }}
            onRemoveOption={(i) => selectedNode && commit(removeOption(state, selectedNode.id, i))}
          />
        </div>

        {widgetChannel && flowId ? (
          <WebBotPanels
            tab={shownTab}
            channel={widgetChannel}
            whatsapp={whatsappDefaultsFrom(
              state.nodes.find((n) => n.type === 'trigger'),
              ctx.senders.chat,
            )}
            flowId={flowId}
            flowName={name}
            published={published}
            canEdit={canEditFlow}
          />
        ) : null}

        <SaveConfirmModal
          open={saveOpen}
          busy={busy}
          initialName={name}
          onClose={() => !busy && setSaveOpen(false)}
          onSave={(n) => void saveFlow(n)}
        />
        {validationItems ? (
          <ValidationPopup
            items={validationItems}
            nodes={state.nodes.flatMap((n) => {
              if (!invalid.has(n.id)) return [];
              // Several nodes of one kind would read the same, so each is numbered by its place among them on the canvas.
              const same = state.nodes.filter((x) => x.type === n.type);
              const label = nodeLabel(tf, n.type);
              return [
                { id: n.id, label: same.length > 1 ? `${label} ${same.indexOf(n) + 1}` : label },
              ];
            })}
            onGoTo={focusNode}
            onClose={() => setVres((v) => (v ? { ...v, popup: false } : v))}
          />
        ) : null}
        <AIGenModal
          open={aiOpen}
          models={ctx.aiModels}
          initialPrompt={aiPrompt}
          flowType={mode}
          onClose={() => setAiOpen(false)}
          onGenerate={applyGenerated}
        />
        <TestPanel
          open={testOpen}
          onClose={() => setTestOpen(false)}
          nodes={state.nodes}
          edges={state.edges}
          runNonce={runNonce}
          templateButtons={(node) => templateQuickReplies(ctx.templates, node)}
          templateExists={(node) =>
            ctx.templates.some((tpl) => tpl.name === String(node.data?.tpl ?? '').trim())
          }
          flowName={(id) => ctx.flows.find((f) => f.id === id)?.name}
        />
        {toastMsg ? (
          <div
            className="fixed top-20 start-1/2 z-[60] -translate-x-1/2 rtl:translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-[12px] font-medium text-background shadow-lg"
            role="status"
          >
            {toastMsg}
          </div>
        ) : null}
      </div>
    </FlowEditorContext.Provider>
  );
}
