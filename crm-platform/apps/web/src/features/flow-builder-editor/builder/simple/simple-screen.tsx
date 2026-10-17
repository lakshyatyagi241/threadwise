'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlowEditorContext } from '../../lib/flow-editor-context';
import { useQuery } from '@tanstack/react-query';
import type { FlbBuilderContext, FlowDetail } from '@crm/contracts';
import { Badge, Button, ConfirmDialog, Drawer, Field, Input, Select, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useFlowWidget } from '@/features/chatbot-widget/api/widgets';
import { ApiError } from '@/lib/api/errors';
import { flowsApi } from '../../api/flows';
import { FLB_KEYS, useBuilderContext } from '../../api/hooks';
import {
  BRANCHING,
  FIXED_EXITS,
  stepKindsFor,
  stepLabel,
  addJourney,
  allSteps,
  duplicateStep,
  emptyDoc,
  groupIndexOf,
  groupsOf,
  groupText,
  insertStep,
  moveStep,
  LIMITS,
  newStep,
  problems,
  removeGroup,
  removeStep,
  renameGroup,
  duplicateGroup,
  stageIn,
  stepSummary,
  toGraph,
  toSimple,
  unreachable,
  updateStep,
  type SimpleDoc,
  type SimpleStep,
  type StepKind,
} from '../../lib/simple-model';
import { applyImport, importToSimple } from '../../lib/simple-import';
import { msg, useFlb, useMsg, type Msg } from '../../lib/msg';
import { BuilderFonts } from '../builder-fonts';
import { TestPanel } from '../simulator/test-panel';
import { templateQuickReplies } from '../../lib/templates';
import { FaqLeaveConfirm } from '@/features/faq-knowledge/components/faq-leave-confirm';
import { FaqPanel } from '@/features/faq-knowledge/components/faq-panel';
import {
  BuilderTabs,
  WebBotPanels,
  useBuilderTab,
  whatsappDefaultsFrom,
  type BuilderTab,
} from '../web-bot-tabs';
import { LinkSelect, NEW_JOURNEY, StepEditor } from './step-editors';
import { StepPreview } from './step-preview';
import { variableNames } from '../../lib/stored-names';
import '../builder.css';
import { lookOf } from '../../lib/node-ui';

const errMessage = (e: unknown, fallback: string): string =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : fallback;

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * The Simple flow builder (an addition beyond Reference, switched on in Admin > Project settings > Flow builder). A flow is a list of
 * steps one under another, grouped in flows ("journeys") like the console's bot builder; a button or list row leads to any step.
 * It saves the same graph the Advanced canvas does, through the same API, so a flow runs the same and opens in either builder.
 */
export function SimpleScreen({
  flowId: initialFlowId,
  channel = 'chat',
}: {
  flowId?: string;
  /** The channel a new bot is built for (an opened bot keeps its own). */
  channel?: 'chat' | 'web';
}) {
  const t = useTranslations('flb.builder.simple');
  const flowQuery = useQuery({
    queryKey: initialFlowId ? FLB_KEYS.flow(initialFlowId) : ['flb', 'flow', 'new'],
    queryFn: ({ signal }) => flowsApi.get(initialFlowId!, signal),
    enabled: !!initialFlowId,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const overview = useQuery({
    queryKey: FLB_KEYS.overview,
    queryFn: ({ signal }) => flowsApi.overview(signal),
  });
  const { ctx, loading } = useBuilderContext();
  if (loading || overview.isPending || (initialFlowId && flowQuery.isPending)) {
    return (
      <div className="flb-root fixed inset-0 z-40 grid place-items-center bg-background text-[13px] text-muted-foreground">
        <BuilderFonts />
        {t('loading')}
      </div>
    );
  }
  return (
    <SimpleInner
      key={initialFlowId ?? 'new'}
      initial={flowQuery.data ?? null}
      newChannel={channel}
      ctx={ctx}
      advancedAllowed={overview.data?.builderMode !== 'simple'}
    />
  );
}

function SimpleInner({
  initial,
  newChannel,
  ctx,
  advancedAllowed,
}: {
  newChannel: 'chat' | 'web';
  initial: FlowDetail | null;
  ctx: FlbBuilderContext;
  advancedAllowed: boolean;
}) {
  const t = useTranslations('flb.builder.simple');
  const m = useMsg();
  const { toast } = useToast();
  // A bot is built for one channel, chosen when it is created; it never changes afterwards. It is read once: the first save rewrites
  // the address from `?type=web` to the saved bot's, and the channel must not follow that.
  const [channel] = useState<'chat' | 'web'>(() =>
    initial ? (initial.flowType === 'web' ? 'web' : 'chat') : newChannel,
  );
  const parsed = useMemo(() => {
    if (!initial) {
      const d = emptyDoc();
      // One connected number: pick it for them (a website chat bot has no number).
      const only =
        channel === 'chat' && ctx.senders.chat.length === 1 ? ctx.senders.chat[0]! : null;
      if (only) d.trigger.data.deviceId = only.key;
      // A visitor opening the chat starts the bot, so a website bot begins on any first message.
      if (channel === 'web') d.trigger.data.keywordMode = 'any';
      return { ok: true as const, doc: d };
    }
    if (initial.flowType !== 'chat' && initial.flowType !== 'web')
      return {
        ok: false as const,
        reasons: [msg('builder.simple.needsAdvanced.otherType', { type: initial.flowType })],
      };
    return toSimple(initial.graph);
  }, [initial, channel, ctx.senders.chat]);

  if (!parsed.ok) {
    return (
      <div className="flb-root fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-muted p-6 text-foreground">
        <BuilderFonts />
        <div className="w-full max-w-lg rounded-2xl border border-border bg-background p-6">
          <h1 className="font-serif text-[22px]">{t('needsAdvanced.title')}</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">{t('needsAdvanced.intro')}</p>
          <ul className="mt-3 list-disc space-y-1 ps-5 text-[13px]">
            {parsed.reasons.map((r) => (
              <li key={JSON.stringify(r)}>{m(r)}</li>
            ))}
          </ul>
          <div className="mt-5 flex gap-2">
            <Link
              href="/flows"
              className="rounded-full border border-border px-4 py-2 text-[12px] font-medium hover:bg-muted"
            >
              {t('backToFlows')}
            </Link>
            {advancedAllowed && initial ? (
              <Link
                href={`/flows/builder/${initial.id}`}
                className="rounded-full bg-brand px-4 py-2 text-[12px] font-semibold text-brand-foreground"
              >
                {t('openAdvanced')}
              </Link>
            ) : (
              <p className="self-center text-[12px] text-muted-foreground">
                {t('needsAdvanced.advancedOff')}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <Editor
      initialDoc={parsed.doc}
      initial={initial}
      channel={channel}
      ctx={ctx}
      advancedAllowed={advancedAllowed}
      toast={toast}
    />
  );
}

function Editor({
  initialDoc,
  initial,
  channel,
  ctx,
  advancedAllowed,
  toast,
}: {
  initialDoc: SimpleDoc;
  initial: FlowDetail | null;
  channel: 'chat' | 'web';
  ctx: FlbBuilderContext;
  advancedAllowed: boolean;
  toast: (m: string, tone?: 'success' | 'danger' | 'info') => number;
}) {
  const t = useTranslations('flb.builder.simple');
  const tw = useTranslations('flb.builder.webBot');
  const tEd = useTranslations('flb.builder.simple.editors');
  const tCommon = useTranslations('flb.common');
  const tTool = useTranslations('flb.builder.shell.toolbar');
  const m = useMsg();
  const tf = useFlb();
  const defaultName = t('defaultName');
  const [doc, setDoc] = useState<SimpleDoc>(initialDoc);
  const [name, setName] = useState(initial?.name ?? defaultName);
  const [flowId, setFlowId] = useState<string | null>(initial?.id ?? null);
  const [rowVersion, setRowVersion] = useState(initial?.rowVersion ?? 1);
  const [published, setPublished] = useState(initial?.isPublished ?? false);
  const [dirty, setDirty] = useState(!initial);
  const [busy, setBusy] = useState(false);
  // Every saved flow has FAQs beside Build (for a person who may read them); a website chat or WhatsApp bot also has Customize and Deploy.
  const canFaqs = useCan('faq.entries.read');
  const tabSet = useMemo(() => ({ faqs: canFaqs, web: true }), [canFaqs]);
  const [tab, setTab] = useBuilderTab(!!flowId, tabSet);
  // A tab this flow does not offer (FAQs before the first save, Customize on a chat flow) is never shown, whatever the link asked for.
  const shownTab: BuilderTab = tab === 'faqs' ? (flowId && canFaqs ? 'faqs' : 'build') : tab;
  // The FAQs panel tells us when one of its screens holds unsaved edits: leaving the tab asks first. The flow's own unsaved
  // edits are untouched by a tab change (the Build page stays mounted underneath).
  const faqDirty = useRef(false);
  const [leaveTo, setLeaveTo] = useState<BuilderTab | null>(null);
  const onFaqDirty = useCallback((d: boolean) => {
    faqDirty.current = d;
  }, []);
  const requestTab = (next: BuilderTab) => {
    if (shownTab === 'faqs' && next !== 'faqs' && faqDirty.current) setLeaveTo(next);
    else setTab(next);
  };
  const canEditFlow = useCan('flb.flows.update');
  const widgetQuery = useFlowWidget(flowId);
  const needsCustomizing = !!flowId && widgetQuery.data?.widget === null;
  const [gi, setGi] = useState(0);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<{
    doc: SimpleDoc;
    name: string | null;
    notes: Msg[];
  } | null>(null);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const [importFailed, setImportFailed] = useState<string[]>([]);

  const change = useCallback((next: SimpleDoc) => {
    setDoc(next);
    setDirty(true);
  }, []);

  const senderRequired = channel === 'chat' && ctx.senders.chat.length > 0;
  // What stops a publish.
  const found = useMemo(() => problems(doc, { senderRequired }), [doc, senderRequired]);
  // Parts nothing leads to: they would never run, but they harm nothing, so they only warn (an imported flow has many).
  const notReached = useMemo(
    () =>
      unreachable(doc).map((s) => ({
        stepId: s.id,
        message: t('notReachedItem', {
          summary: stepSummary(s, tf) || m(stepLabel(s)),
          stage: stageIn(
            doc,
            doc.journeys.findIndex((j) => j.steps[0]?.id === s.id),
            0,
          ),
        }),
      })),
    [doc, t, tf, m],
  );
  const [showUnreached, setShowUnreached] = useState(false);
  const openStep = (stepId: string | null) => {
    if (stepId) {
      const at = doc.journeys.findIndex((j) => j.steps.some((s) => s.id === stepId));
      if (at >= 0) setGi(groupIndexOf(doc, at));
      setActiveId(stepId);
      // The step may be in another flow of the list: wait for it to be drawn, then bring it into view.
      window.setTimeout(
        () =>
          document
            .getElementById(`step-${stepId}`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
        60,
      );
    } else setGi(0);
  };
  const badSteps = useMemo(
    () => new Set(found.map((p) => p.stepId).filter((x): x is string => !!x)),
    [found],
  );

  const groups = groupsOf(doc);
  const group = groups[Math.min(gi, groups.length - 1)]!;
  const gIndex = groups.indexOf(group);

  // --- edits ----------------------------------------------------------------------------------------------------------
  /** Add a step to one chain of the open flow. */
  const add = (chain: number, at: number, kind: StepKind) => {
    const step = newStep(kind.type, allSteps(doc), kind.preset);
    const next = insertStep(doc, chain, at, step);
    if (next === doc) return;
    change(next);
    setActiveId(step.id);
  };

  const setData = (id: string, patch: Record<string, unknown>, links?: (string | null)[]) =>
    change(updateStep(doc, id, { data: patch, ...(links ? { links } : {}) }));

  /** A button (or the end of a part) asked to lead to a new flow: ask which part it starts with before anything is created. */
  const [newFlowFor, setNewFlowFor] = useState<
    { kind: 'link'; stepId: string; i: number } | { kind: 'goto'; stepId: string } | null
  >(null);

  const linkTo = (id: string, i: number, target: string | null, first?: SimpleStep) => {
    const step = allSteps(doc).find((s) => s.id === id);
    if (!step) return;
    let next = doc;
    let to = target;
    if (first) {
      next = addJourney(next, first);
      to = first.id;
      setGi(groupsOf(next).length - 1);
      setActiveId(first.id);
    }
    const links = step.links.slice();
    links[i] = to;
    change(updateStep(next, id, { links }));
  };

  const link = (id: string, i: number, target: string | null) => {
    if (target === NEW_JOURNEY) {
      setNewFlowFor({ kind: 'link', stepId: id, i });
      return;
    }
    linkTo(id, i, target);
  };

  /**
   * The "+" under a set of buttons or a list: the chosen step starts a new part, tied to the first button that leads nowhere yet. When
   * every button already leads somewhere, a new button (or row) is added for it, up to the limit.
   */
  const addBranch = (stepId: string, kind: StepKind) => {
    const step = allSteps(doc).find((x) => x.id === stepId);
    if (!step) return;
    const options = Array.isArray(step.data.options) ? (step.data.options as unknown[]) : [];
    let idx = options.findIndex((_, i) => !step.links[i]);
    let data: Record<string, unknown> | undefined;
    if (idx < 0) {
      const max = step.type === 'list' ? LIMITS.rows : LIMITS.buttons;
      if (options.length >= max) return;
      idx = options.length;
      const added =
        step.type === 'list'
          ? { title: `Item ${idx + 1}`, description: '', section: '' }
          : tEd('buttons.placeholder', { n: idx + 1 });
      data = { options: [...options, added] };
    }
    const first = newStep(kind.type, allSteps(doc), kind.preset);
    let next = addJourney(doc, first);
    const links = step.links.slice();
    links[idx] = first.id;
    next = updateStep(next, stepId, { ...(data ? { data } : {}), links });
    change(next);
    setGi(groupsOf(next).length - 1);
    setActiveId(first.id);
  };

  /** Where the last step of a part carries on (a "node to node" connection). */
  const setGoto = (id: string, target: string | null, first?: SimpleStep) => {
    if (target === NEW_JOURNEY) {
      setNewFlowFor({ kind: 'goto', stepId: id });
      return;
    }
    let next = doc;
    let to = target;
    if (first) {
      next = addJourney(next, first);
      to = first.id;
      setGi(groupsOf(next).length - 1);
      setActiveId(first.id);
    }
    change(updateStep(next, id, { goto: to }));
  };

  const setTrigger = (patch: Record<string, unknown>) =>
    change({ ...doc, trigger: { ...doc.trigger, data: { ...doc.trigger.data, ...patch } } });

  // --- import ---------------------------------------------------------------------------------------------------------
  const finishImport = (imp: { doc: SimpleDoc; name: string | null; notes: Msg[] }) => {
    const next = applyImport(doc, imp.doc);
    change(next);
    setGi(0);
    setActiveId(null);
    if (imp.name && (name.trim() === '' || name === defaultName)) setName(imp.name);
    setImportFailed([]);
    setImportNotes(imp.notes.map(m));
    const steps = allSteps(next).length;
    toast(t('imported', { steps, flows: groupsOf(next).length }), 'success');
  };

  const onImportFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setImportNotes([]);
      setImportFailed([t('invalidJson')]);
      return;
    }
    const res = importToSimple(raw);
    if (!res.ok) {
      setImportNotes([]);
      setImportFailed(res.reasons.map(m));
      return;
    }
    if (allSteps(doc).length > 0) setPendingImport(res);
    else finishImport(res);
  };

  // --- test run -------------------------------------------------------------------------------------------------------
  // The chat simulator reads the flow as it is on screen (saved or not): nothing is sent to anyone.
  const [testOpen, setTestOpen] = useState(false);
  const [runNonce, setRunNonce] = useState(0);
  const testGraph = useMemo(() => toGraph(doc), [doc]);

  // --- save / publish -------------------------------------------------------------------------------------------------
  const payload = () => {
    const g = toGraph(doc);
    return {
      name: name.trim() || defaultName,
      category: initial?.category ?? null,
      flowType: channel,
      graph: {
        flowNodes: g.flowNodes as unknown as Array<Record<string, unknown>>,
        flowEdges: g.flowEdges.map(({ id, source, sourceHandle, target }) => ({
          id,
          source,
          sourceHandle,
          target,
        })),
        vars: g.vars as unknown as Array<Record<string, unknown>>,
      },
    };
  };

  const persist = async () => {
    const saved = flowId
      ? await flowsApi.save(flowId, { ...payload(), rowVersion })
      : await flowsApi.create(payload());
    if (!flowId) {
      setFlowId(saved.id);
      window.history.replaceState({}, '', `/flows/simple/${saved.id}`);
    }
    setRowVersion(saved.rowVersion);
    setName(saved.name);
    setDirty(false);
    return saved;
  };

  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await persist();
      toast(t('saved', { name: saved.name }), 'success');
    } catch (e) {
      toast(t('saveFailed', { error: errMessage(e, t('genericError')) }), 'danger');
    } finally {
      setBusy(false);
    }
  };

  // Clicking outside the step being edited closes it and saves what was changed (a menu, picker or dialog opened from the step does
  // not count as outside). A failed save says so; a good one stays quiet, the Save button and the badge show the state.
  const closeAndSave = useRef<() => void>(() => undefined);
  useEffect(() => {
    closeAndSave.current = () => {
      setActiveId(null);
      if (!dirty || busy || !canEditFlow) return;
      setBusy(true);
      persist()
        .catch((e: unknown) =>
          toast(t('saveFailed', { error: errMessage(e, t('genericError')) }), 'danger'),
        )
        .finally(() => setBusy(false));
    };
  });

  useEffect(() => {
    if (!activeId) return;
    const onOutside = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target || !target.isConnected) return;
      if (target.closest(`#step-${activeId}, [data-step-tools="${activeId}"]`)) return;
      if (
        target.closest(
          '[role="dialog"],[role="listbox"],[role="menu"],[role="alertdialog"],[data-radix-popper-content-wrapper]',
        )
      )
        return;
      closeAndSave.current();
    };
    // The click, not the press: closing the step moves what is below it, and a press-time close would send the click to the wrong place
    // (the + under the step, or the next step's header).
    document.addEventListener('click', onOutside, true);
    return () => document.removeEventListener('click', onOutside, true);
  }, [activeId]);

  const onPublish = async () => {
    if (busy) return;
    if (found.length > 0) {
      setShowProblems(true);
      return;
    }
    setBusy(true);
    try {
      const saved = dirty || !flowId ? await persist() : null;
      {
        // A bot goes live with the widget its owner chose (the chat window, or the WhatsApp button), so Customize has to be saved
        // once first. A bot saved just now has no widget yet; for a saved one, ask if the page has not loaded the answer.
        const widget = !flowId
          ? null
          : ((widgetQuery.data ?? (await widgetQuery.refetch()).data)?.widget ?? null);
        if (!widget) {
          setTab('customize');
          toast(tw(channel === 'web' ? 'customizeFirst' : 'customizeFirstWhatsapp'), 'danger');
          return;
        }
      }
      const pub = await flowsApi.publish(saved?.id ?? flowId!);
      setRowVersion(pub.rowVersion);
      setPublished(true);
      toast(t('publishedToast'), 'success');
    } catch (e) {
      toast(t('publishFailed', { error: errMessage(e, t('genericError')) }), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const status = published
    ? dirty
      ? t('status.publishedUnsaved')
      : t('status.published')
    : dirty
      ? t('status.draftUnsaved')
      : t('status.draft');

  return (
    <FlowEditorContext.Provider value={{ flowId, web: channel === 'web' }}>
      <div className="flb-root fixed inset-0 z-40 flex flex-col bg-muted text-foreground">
        <BuilderFonts />
        <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
          <Link
            href="/flows"
            aria-label={t('backToFlows')}
            title={t('backToFlows')}
            className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-muted"
          >
            ←
          </Link>
          <input
            aria-label={t('flowName')}
            value={name}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            className="h-9 min-w-0 max-w-sm flex-1 rounded-lg border border-transparent bg-transparent px-2 font-serif text-[18px] hover:border-border focus:border-border focus:outline-none"
          />
          <Badge tone={published && !dirty ? 'success' : dirty ? 'warning' : 'neutral'}>
            {status}
          </Badge>
          <Badge>{t('simpleBuilder')}</Badge>
          <div className="ms-auto flex items-center gap-2">
            {found.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowProblems((v) => !v)}
                className="rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-[12px] font-medium text-warning"
              >
                {t('toFix', { count: found.length })}
              </button>
            ) : null}
            {notReached.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowUnreached((v) => !v)}
                className="rounded-full border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted"
                title={t('notReachedTitle')}
              >
                {t('notReachedCount', { count: notReached.length })}
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              data-simple-import-input
              onChange={(e) => void onImportFile(e.target.files?.[0])}
            />
            <button
              type="button"
              data-simple-import
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="rounded-full border border-border px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
              title={t('importTitle')}
            >
              {t('import')}
            </button>
            {advancedAllowed && flowId ? (
              <Link
                href={`/flows/builder/${flowId}`}
                className="hidden rounded-full border border-border px-3 py-1.5 text-[12px] font-medium hover:bg-muted sm:block"
                title={t('openOnCanvas')}
              >
                {t('openAdvanced')}
              </Link>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setTestOpen(true);
                setRunNonce((n) => n + 1);
              }}
            >
              {tTool('test')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !dirty}
              onClick={() => void onSave()}
            >
              {t('save')}
            </Button>
            <Button variant="brand" size="sm" disabled={busy} onClick={() => void onPublish()}>
              {published ? t('publishChanges') : t('publish')}
            </Button>
          </div>
        </header>

        <BuilderTabs
          tab={shownTab}
          onTab={requestTab}
          saved={!!flowId}
          needsCustomizing={needsCustomizing}
          faqs={canFaqs}
          web
        />

        {importFailed.length > 0 ? (
          <div
            role="alert"
            className="shrink-0 border-b border-danger/30 bg-danger/10 px-4 py-2 text-[12.5px]"
          >
            <div className="mb-1 flex items-center justify-between font-medium">
              <span>{t('importFailedTitle')}</span>
              <button
                type="button"
                className="text-[12px] underline"
                onClick={() => setImportFailed([])}
              >
                {tCommon('dismiss')}
              </button>
            </div>
            <ul className="list-disc space-y-0.5 ps-5">
              {importFailed.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {importNotes.length > 0 ? (
          <div className="shrink-0 border-b border-border bg-background px-4 py-2 text-[12.5px]">
            <div className="mb-1 flex items-center justify-between font-medium">
              <span>{t('importNotesTitle')}</span>
              <button
                type="button"
                className="text-[12px] underline"
                onClick={() => setImportNotes([])}
              >
                {tCommon('dismiss')}
              </button>
            </div>
            <ul className="list-disc space-y-0.5 ps-5 text-muted-foreground">
              {importNotes.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {showProblems && found.length > 0 ? (
          <div className="shrink-0 border-b border-warning/30 bg-warning/10 px-4 py-2 text-[12.5px]">
            <div className="mb-1 font-medium">{t('fixBeforePublishing')}</div>
            <ul className="list-disc space-y-0.5 ps-5">
              {found.map((p, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="text-start underline-offset-2 hover:underline"
                    onClick={() => openStep(p.stepId)}
                  >
                    {m(p.message)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {showUnreached && notReached.length > 0 ? (
          <div className="max-h-40 shrink-0 overflow-y-auto border-b border-border bg-background px-4 py-2 text-[12.5px]">
            <div className="mb-1 flex items-center justify-between font-medium">
              <span>{t('notReachedPanel')}</span>
              <button
                type="button"
                className="text-[12px] underline"
                onClick={() => setShowUnreached(false)}
              >
                {t('hide')}
              </button>
            </div>
            <ul className="list-disc space-y-0.5 ps-5 text-muted-foreground">
              {notReached.map((p) => (
                <li key={p.stepId}>
                  <button
                    type="button"
                    className="text-start underline-offset-2 hover:underline"
                    onClick={() => openStep(p.stepId)}
                  >
                    {p.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className={`flex min-h-0 flex-1 ${shownTab === 'build' ? '' : 'hidden'}`}>
          <aside className="hidden w-72 shrink-0 flex-col border-e border-border bg-background md:flex">
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="text-[15px] font-semibold">{t('flows')}</span>
              <button
                type="button"
                onClick={() => {
                  const first = newStep('message', allSteps(doc));
                  const next = addJourney(doc, first);
                  change(next);
                  setGi(groupsOf(next).length - 1);
                  setActiveId(first.id);
                }}
                className="rounded-lg border border-border px-3 py-1 text-[12px] font-medium hover:bg-muted"
              >
                {t('newFlowSidebar')}
              </button>
            </div>
            <div className="px-4 py-3">
              <Input
                aria-label={t('searchFlows')}
                placeholder={t('search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label={t('flows')}>
              {groups.map((g, i) => {
                if (
                  query.trim() &&
                  !groupText(g, tf).toLowerCase().includes(query.trim().toLowerCase())
                )
                  return null;
                const head = doc.journeys[g.chains[0]!]!.steps[0];
                const lost = i > 0 && head && unreachable(doc).some((s) => s.id === head.id);
                return (
                  <div
                    key={g.key}
                    className={`mb-0.5 flex items-center gap-2 rounded-xl px-2 py-1 ${
                      i === gIndex ? 'bg-muted font-semibold' : 'hover:bg-muted/60'
                    }`}
                  >
                    <button
                      type="button"
                      data-flow-entry
                      onClick={() => {
                        setGi(i);
                        setActiveId(null);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-start text-[13px]"
                    >
                      <span className="w-5 shrink-0 text-end font-mono text-[12px] text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{groupText(g, tf)}</span>
                      {lost ? (
                        <span title={t('nothingLeadsHere')} className="text-warning">
                          !
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      aria-label={t('duplicateNamed', { name: groupText(g, tf) })}
                      title={t('duplicateFlow')}
                      onClick={() => {
                        const r = duplicateGroup(doc, i);
                        change(r.doc);
                        setGi(r.group);
                        setActiveId(null);
                      }}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-brand hover:bg-background"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                        <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
                      </svg>
                    </button>
                    <span className="w-6 shrink-0 text-end font-mono text-[12px] text-muted-foreground">
                      {String(g.steps).padStart(2, '0')}
                    </span>
                  </div>
                );
              })}
            </nav>
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[24rem] px-4 py-6">
              <div className="mb-4 flex flex-wrap items-center gap-2 md:hidden">
                <Select
                  aria-label={t('flowSelect')}
                  value={gIndex}
                  onChange={(e) => {
                    setGi(Number(e.target.value));
                    setActiveId(null);
                  }}
                  className="h-9 flex-1"
                >
                  {groups.map((g, i) => (
                    <option key={g.key} value={i}>
                      {i + 1}. {groupText(g, tf)}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const first = newStep('message', allSteps(doc));
                    const next = addJourney(doc, first);
                    change(next);
                    setGi(groupsOf(next).length - 1);
                    setActiveId(first.id);
                  }}
                >
                  {t('newFlowMobile')}
                </Button>
              </div>

              <div className="mb-4 flex items-end gap-2">
                <Field label={t('flowName')} className="flex-1" eyebrow>
                  <Input
                    value={group.placeholder && gIndex > 0 ? '' : groupText(group, tf)}
                    placeholder={t('flowPlaceholder', { n: gIndex + 1 })}
                    onChange={(e) => change(renameGroup(doc, gIndex, e.target.value))}
                  />
                </Field>
                {gIndex > 0 ? (
                  <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(gIndex)}>
                    {t('deleteFlow')}
                  </Button>
                ) : null}
              </div>

              {gIndex === 0 ? (
                <TriggerCard
                  doc={doc}
                  ctx={ctx}
                  channel={channel}
                  set={setTrigger}
                  bad={showProblems && found.some((p) => p.stepId === null)}
                />
              ) : null}

              {group.chains.map((ci, part) => {
                const journey = doc.journeys[ci]!;
                const head = journey.steps[0];
                const lostPart = part > 0 && head && unreachable(doc).some((s) => s.id === head.id);
                return (
                  <div key={head?.id ?? `chain-${ci}`}>
                    {part > 0 ? (
                      <p className="my-4 rounded-xl border border-dashed border-border px-3 py-2 text-center text-[11.5px] text-muted-foreground">
                        {t('anotherPart', { lost: lostPart ? 'true' : 'false' })}
                      </p>
                    ) : null}
                    <AddMenu
                      channel={channel}
                      onPick={(k) => add(ci, 0, k)}
                      atEnd={journey.steps.length === 0}
                      hint={journey.steps.length === 0 ? t('addFirstStep') : undefined}
                    />
                    {journey.steps.map((s, si) => (
                      <div key={s.id}>
                        <StepCard
                          step={s}
                          doc={doc}
                          ctx={ctx}
                          flowId={flowId}
                          stage={stageIn(doc, ci, si)}
                          active={activeId === s.id}
                          bad={badSteps.has(s.id)}
                          first={si === 0}
                          last={si === journey.steps.length - 1}
                          onToggle={() => setActiveId(activeId === s.id ? null : s.id)}
                          onSet={(patch, links) => setData(s.id, patch, links)}
                          onLink={(i, target) => link(s.id, i, target)}
                          onMove={(d) => change(moveStep(doc, s.id, d))}
                          onCopy={() => change(duplicateStep(doc, s.id))}
                          actionKinds={stepKindsFor(channel).filter((k) =>
                            ACTION_KINDS.includes(k.key),
                          )}
                          onAddAction={BRANCHING.has(s.type) ? null : (k) => add(ci, si + 1, k)}
                          onAddCondition={
                            BRANCHING.has(s.type) || si !== journey.steps.length - 1
                              ? null
                              : () => {
                                  const k = stepKindsFor(channel).find(
                                    (x) => x.type === 'condition',
                                  );
                                  if (k) add(ci, si + 1, k);
                                }
                          }
                          onDelete={() => {
                            change(removeStep(doc, s.id));
                            setActiveId(null);
                          }}
                        />
                        {BRANCHING.has(s.type) ? (
                          <p className="my-3 text-center text-[11.5px] text-muted-foreground">
                            {s.type === 'faq'
                              ? t('faqEnds')
                              : t('branchingEnds', {
                                  kind: s.type === 'list' ? 'list' : 'buttons',
                                })}
                          </p>
                        ) : null}
                        {s.type === 'buttons' || s.type === 'list' ? (
                          <>
                            <div
                              className="mb-3 flex flex-wrap justify-center gap-2"
                              data-testid="branch-adders"
                            >
                              {(Array.isArray(s.data.options) ? s.data.options : []).map(
                                (o: unknown, i: number) => {
                                  // A button that already leads somewhere has its step; one that ends gets a quick way to start one.
                                  if (s.links[i]) return null;
                                  const label =
                                    typeof o === 'string'
                                      ? o
                                      : str((o as Record<string, unknown>).title);
                                  return (
                                    <button
                                      key={i}
                                      type="button"
                                      onClick={() => link(s.id, i, NEW_JOURNEY)}
                                      className="rounded-full border border-dashed border-border px-3.5 py-1.5 text-[12px] font-semibold text-brand hover:bg-muted"
                                    >
                                      + {t('branchAdd', { title: label || `#${i + 1}` })}
                                    </button>
                                  );
                                },
                              )}
                            </div>
                            <AddMenu channel={channel} onPick={(k) => addBranch(s.id, k)} atEnd />
                          </>
                        ) : BRANCHING.has(s.type) ? null : (
                          <>
                            <AddMenu
                              channel={channel}
                              onPick={(k) => add(ci, si + 1, k)}
                              atEnd={si === journey.steps.length - 1}
                            />
                            {si === journey.steps.length - 1 ? (
                              <div className="mb-3 flex items-center gap-2">
                                <span className="shrink-0 text-[12px] text-muted-foreground">
                                  {t('thenGoTo')}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <LinkSelect
                                    doc={doc}
                                    stepId={s.id}
                                    value={s.goto ?? null}
                                    onChange={(target) => setGoto(s.id, target)}
                                  />
                                </div>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </main>
        </div>

        <TestPanel
          open={testOpen}
          onClose={() => setTestOpen(false)}
          nodes={testGraph.flowNodes}
          edges={testGraph.flowEdges}
          runNonce={runNonce}
          templateButtons={(node) => templateQuickReplies(ctx.templates, node)}
          templateExists={(node) =>
            ctx.templates.some((tpl) => tpl.name === String(node.data?.tpl ?? '').trim())
          }
          flowName={(id) => ctx.flows.find((f) => f.id === id)?.name}
        />

        <AddMenu
          channel={channel}
          atEnd
          modal={{ open: newFlowFor !== null, onDismiss: () => setNewFlowFor(null) }}
          onPick={(k) => {
            if (!newFlowFor) return;
            const first = newStep(k.type, allSteps(doc), k.preset);
            if (newFlowFor.kind === 'link') linkTo(newFlowFor.stepId, newFlowFor.i, null, first);
            else setGoto(newFlowFor.stepId, null, first);
            setNewFlowFor(null);
          }}
        />

        <ConfirmDialog
          open={pendingImport !== null}
          title={t('confirmImport.title')}
          message={t('confirmImport.message')}
          confirmLabel={t('confirmImport.confirm')}
          cancelLabel={tCommon('cancel')}
          tone="danger"
          onClose={() => setPendingImport(null)}
          onConfirm={() => {
            if (pendingImport) finishImport(pendingImport);
            setPendingImport(null);
          }}
        />

        {flowId && canFaqs ? (
          <div
            role="tabpanel"
            id="web-bot-panel-faqs"
            aria-labelledby="web-bot-tab-faqs"
            className={`min-h-0 flex-1 overflow-y-auto bg-background ${shownTab === 'faqs' ? '' : 'hidden'}`}
          >
            {shownTab === 'faqs' ? (
              <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
                <FaqPanel flowId={flowId} flowName={name} onDirtyChange={onFaqDirty} />
              </div>
            ) : null}
          </div>
        ) : null}
        <FaqLeaveConfirm
          open={leaveTo !== null}
          onStay={() => setLeaveTo(null)}
          onLeave={() => {
            const next = leaveTo;
            setLeaveTo(null);
            faqDirty.current = false;
            if (next) setTab(next);
          }}
        />

        {flowId ? (
          <WebBotPanels
            tab={shownTab}
            channel={channel}
            whatsapp={whatsappDefaultsFrom(doc.trigger, ctx.senders.chat)}
            flowId={flowId}
            flowName={name}
            published={published}
            canEdit={canEditFlow}
          />
        ) : null}

        <ConfirmDialog
          open={confirmDelete !== null}
          title={t('confirmDelete.title')}
          message={t('confirmDelete.message')}
          confirmLabel={t('deleteFlow')}
          cancelLabel={tCommon('cancel')}
          tone="danger"
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            if (confirmDelete !== null) {
              change(removeGroup(doc, confirmDelete));
              setGi(0);
              setActiveId(null);
            }
            setConfirmDelete(null);
          }}
        />
      </div>
    </FlowEditorContext.Provider>
  );
}

function TriggerCard({
  doc,
  ctx,
  channel,
  set,
  bad,
}: {
  doc: SimpleDoc;
  ctx: FlbBuilderContext;
  channel: 'chat' | 'web';
  set: (patch: Record<string, unknown>) => void;
  bad: boolean;
}) {
  const t = useTranslations('flb.builder.simple.trigger');
  const d = doc.trigger.data;
  const kind = str(d.kind) || 'keyword';
  const any = str(d.keywordMode) === 'any';
  // One connected number is the bot's number: it is not asked for, only shown.
  const only = ctx.senders.chat.length === 1 ? ctx.senders.chat[0]! : null;
  useEffect(() => {
    if (channel !== 'web' && only && str(d.deviceId) !== only.key) set({ deviceId: only.key });
  }, [channel, only, d.deviceId, set]);
  return (
    <section
      className={`rounded-2xl border bg-background p-4 ${bad ? 'border-danger' : 'border-border'}`}
      aria-label={t('aria')}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-brand/10 text-brand">
          ▶
        </span>
        <div className="font-semibold">{t('title')}</div>
      </div>
      {kind !== 'keyword' ? (
        <p className="mb-3 rounded-lg bg-muted p-2.5 text-[12.5px] text-muted-foreground">
          {t('otherKind', { kind: kind.replace(/_/g, ' ') })}
        </p>
      ) : (
        <div className="space-y-3">
          <Field label={t('startsWhen')}>
            <Select
              value={any ? 'any' : 'keywords'}
              onChange={(e) => set({ keywordMode: e.target.value })}
            >
              <option value="keywords">{t('oneOfWords')}</option>
              <option value="any">{t('anyMessage')}</option>
            </Select>
          </Field>
          {!any ? (
            <Field label={t('words')} hint={t('wordsHint')}>
              <Input
                value={str(d.keywords)}
                placeholder={t('wordsPlaceholder')}
                onChange={(e) => set({ keywords: e.target.value })}
              />
            </Field>
          ) : null}
        </div>
      )}
      {channel === 'web' ? null : only ? (
        <p
          data-testid="trigger-connected-number"
          className="mt-3 rounded-lg bg-muted p-2.5 text-[12.5px] text-muted-foreground"
        >
          {t('connectedNumber', {
            number: `${only.label}${only.phone ? ` · ${only.phone}` : ''}`,
          })}
        </p>
      ) : (
        <Field
          className="mt-3"
          label={t('whatsappNumber')}
          hint={ctx.senders.chat.length === 0 ? t('noNumberHint') : undefined}
        >
          <Select value={str(d.deviceId)} onChange={(e) => set({ deviceId: e.target.value })}>
            <option value="">{t('chooseNumber')}</option>
            {ctx.senders.chat.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
                {s.phone ? ` · ${s.phone}` : ''}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </section>
  );
}

/** The steps the ⚡ Actions list offers: what can run right after a step. */
const ACTION_KINDS: readonly string[] = ['api-library', 'code', 'delay'];

function AddMenu({
  onPick,
  channel,
  atEnd,
  hint,
  modal,
}: {
  onPick: (k: StepKind) => void;
  channel: 'chat' | 'web';
  atEnd: boolean;
  hint?: string;
  /** Opened from elsewhere (a button that should lead to a new flow): no "+" is drawn, the menu is centred over the page. */
  modal?: { open: boolean; onDismiss: () => void };
}) {
  const t = useTranslations('flb.builder.simple.add');
  const m = useMsg();
  const [openLocal, setOpen] = useState(false);
  const open = modal ? modal.open : openLocal;
  const box = useRef<HTMLDivElement>(null);
  const tClose = useTranslations('flb.builder.shell.modals');
  const tSearch = useTranslations('flb.builder.simple');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const close = () => {
    setOpen(false);
    setQ('');
    modal?.onDismiss();
  };
  // The menu closes when the page outside it is clicked, or on Escape (a click inside it, on a step or the + button, is handled there).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div
      ref={box}
      className={
        modal
          ? 'fixed inset-0 z-50 grid place-items-center bg-black/40 p-4'
          : 'relative my-2 flex flex-col items-center'
      }
      onMouseDown={(e) => {
        if (modal && e.target === e.currentTarget) close();
      }}
      hidden={modal ? !modal.open : undefined}
    >
      {modal ? null : <div className="h-3 w-px bg-border" />}
      {modal ? null : (
        <button
          type="button"
          aria-label={hint ?? t('addStep')}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`grid place-items-center rounded-full bg-brand text-brand-foreground shadow-sm hover:opacity-90 ${
            hint
              ? 'h-auto gap-1 px-4 py-2 text-[12.5px] font-semibold'
              : 'h-8 w-8 text-lg leading-none'
          }`}
        >
          {hint ? `+ ${hint}` : '+'}
        </button>
      )}
      {modal ? null : <div className="h-3 w-px bg-border" />}
      {open ? (
        <div
          role="menu"
          className={`flex max-h-[72vh] w-[min(28rem,calc(100vw-2rem))] flex-col rounded-2xl border border-border bg-background shadow-xl ${
            modal ? '' : 'absolute start-1/2 top-12 z-20 -translate-x-1/2 rtl:translate-x-1/2'
          }`}
        >
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <h3 className="text-[15px] font-semibold">{t('addStep')}</h3>
            <button
              type="button"
              aria-label={tClose('close')}
              onClick={close}
              className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              <svg
                viewBox="0 0 16 16"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
              </svg>
            </button>
          </div>
          <div className="px-5 pb-3">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tSearch('search')}
              aria-label={tSearch('search')}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
              autoFocus
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {(['send', 'ask', 'logic', 'action', 'answer', 'handoff'] as const).map((group) => {
              const kinds = stepKindsFor(channel).filter(
                (k) =>
                  k.group === group &&
                  (needle === '' || `${m(k.label)} ${m(k.help)}`.toLowerCase().includes(needle)),
              );
              if (kinds.length === 0) return null;
              return (
                <div key={group} className="mb-4 last:mb-0">
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {t(`groups.${group}`)}
                  </div>
                  <div className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
                    {kinds.map((k) => {
                      const blocked = BRANCHING.has(k.type) && !atEnd;
                      const look = lookOf(k.type);
                      return (
                        <button
                          key={k.key}
                          type="button"
                          role="menuitem"
                          disabled={blocked}
                          title={
                            blocked
                              ? t(k.type === 'faq' ? 'blockedTitleFaq' : 'blockedTitle')
                              : m(k.help)
                          }
                          onClick={() => {
                            close();
                            onPick(k);
                          }}
                          className="flex items-center gap-2.5 rounded-xl p-1.5 text-start outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          <span
                            className="grid size-9 shrink-0 place-items-center rounded-lg"
                            style={{ background: look.bg, color: look.fg }}
                            aria-hidden="true"
                          >
                            <svg
                              viewBox="0 0 16 16"
                              className="size-[18px]"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d={look.icon} />
                            </svg>
                          </span>
                          <span className="min-w-0 text-[13px] font-medium leading-tight">
                            {m(k.label)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StepCard(p: {
  step: SimpleStep;
  doc: SimpleDoc;
  ctx: FlbBuilderContext;
  /** The saved flow (null before the first save): the FAQ step reads this flow's FAQs. */
  flowId: string | null;
  stage: string;
  active: boolean;
  bad: boolean;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onSet: (patch: Record<string, unknown>, links?: (string | null)[]) => void;
  onLink: (i: number, target: string | null) => void;
  onMove: (dir: -1 | 1) => void;
  onCopy: () => void;
  /** The steps the ⚡ Actions list offers (API call, JS function, Wait) on this channel. */
  actionKinds: readonly StepKind[];
  /** Adds the chosen step right after this one; null for a step that ends its part (nothing can follow it). */
  onAddAction: ((k: StepKind) => void) | null;
  /** Adds a Condition right after this step; null when a condition cannot go here (the step ends its part, or is not the last). */
  onAddCondition: (() => void) | null;
  onDelete: () => void;
}) {
  const t = useTranslations('flb.builder.simple.card');
  const tCommon = useTranslations('flb.common');
  const tShell = useTranslations('flb.builder.shell.modals');
  const tSearch = useTranslations('flb.builder.simple');
  const [confirm, setConfirm] = useState<'duplicate' | 'delete' | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionQ, setActionQ] = useState('');
  const m = useMsg();
  const tf = useFlb();
  const { step: s } = p;
  const stageOf = (id: string | null) => {
    if (!id) return null;
    for (let a = 0; a < p.doc.journeys.length; a++) {
      const b = p.doc.journeys[a]!.steps.findIndex((x) => x.id === id);
      if (b >= 0) return stageIn(p.doc, a, b);
    }
    return null;
  };
  const fixed = FIXED_EXITS[s.type];
  /** What each exit of a branching step leads to: the stage number of the step it reaches, or null (the conversation ends). */
  const exits: Array<{ title: string; target: string | null }> = fixed
    ? fixed.map((handle, i) => ({
        title: t(`faqExits.${handle}`),
        target: stageOf(s.links[i] ?? null),
      }))
    : BRANCHING.has(s.type)
      ? (Array.isArray(s.data.options) ? s.data.options : []).map((o: unknown, i: number) => {
          const label = typeof o === 'string' ? o : str((o as Record<string, unknown>).title);
          return { title: label || `#${i + 1}`, target: stageOf(s.links[i] ?? null) };
        })
      : [];
  const look = lookOf(s.type);
  const property =
    s.data.saveProperty === true && str(s.data.propertyKey).trim() ? str(s.data.propertyKey) : '';
  const bodyText = stepSummary(s, tf);
  const tools = () => (
    <>
      {p.active ? (
        <IconBtn label={t('close')} onClick={p.onToggle}>
          <Glyph d="M4 4l8 8M12 4l-8 8" />
        </IconBtn>
      ) : null}
      <IconBtn
        label={p.onAddAction ? t('actions') : t('actionsBlocked')}
        disabled={!p.onAddAction}
        onClick={() => {
          setActionQ('');
          setActionsOpen(true);
        }}
      >
        <Glyph d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" />
      </IconBtn>
      <IconBtn label={t('moveUp')} disabled={p.first} onClick={() => p.onMove(-1)}>
        <Glyph d="M8 13V3M4 7l4-4 4 4" />
      </IconBtn>
      <IconBtn label={t('moveDown')} disabled={p.last} onClick={() => p.onMove(1)}>
        <Glyph d="M8 3v10M4 9l4 4 4-4" />
      </IconBtn>
      {!BRANCHING.has(s.type) ? (
        <IconBtn label={t('duplicate')} onClick={() => setConfirm('duplicate')}>
          <Glyph d="M5.5 5.5h7v7h-7zM3.5 10.5v-7h7" />
        </IconBtn>
      ) : null}
      <IconBtn
        label={p.onAddCondition ? t('addCondition') : t('conditionLast')}
        disabled={!p.onAddCondition}
        onClick={() => p.onAddCondition?.()}
      >
        <Glyph d="M3 8h4M7 8l5-4M7 8l5 4M12 2.5v3M12 10.5v3" />
      </IconBtn>
      <IconBtn label={t('deleteStep')} danger onClick={() => setConfirm('delete')}>
        <Glyph d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5M7 7v4M9 7v4" />
      </IconBtn>
    </>
  );
  return (
    <div className={`group relative ${p.active ? 'z-20' : ''}`}>
      {p.active ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 -z-10 bg-foreground/15"
          />
          <div
            role="status"
            className="pointer-events-none fixed inset-x-0 top-[98px] z-30 bg-background py-3 text-center text-[15px] shadow-sm"
          >
            {t('outsideToSave')}
          </div>
        </>
      ) : null}
      <section
        id={`step-${s.id}`}
        className={`rounded-2xl border bg-background transition ${
          p.bad ? 'border-danger' : p.active ? 'border-brand shadow-md' : 'border-border'
        }`}
      >
        <div className="flex items-center gap-2 p-3">
          <button
            type="button"
            onClick={p.onToggle}
            aria-expanded={p.active}
            title={p.active ? undefined : t('clickToEdit')}
            className="flex min-w-0 flex-1 items-center gap-3 text-start"
          >
            <span
              className="grid size-8 shrink-0 place-items-center rounded-lg"
              style={{ background: look.bg, color: look.fg }}
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 16 16"
                className="size-[18px]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={look.icon} />
              </svg>
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
              {m(stepLabel(s))}
            </span>
            <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{p.stage}</span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground lg:hidden">
            {tools()}
          </div>
        </div>
        {!p.active ? (
          <button
            type="button"
            onClick={p.onToggle}
            title={t('clickToEdit')}
            className="block w-full border-t border-border px-4 pb-4 pt-3 text-start"
          >
            <p className="line-clamp-4 whitespace-pre-wrap break-words text-[13px] text-muted-foreground">
              {bodyText || t('empty')}
            </p>
            {exits.length > 0 ? (
              <div className="mt-3 space-y-2 rounded-lg bg-muted/60 p-3">
                {exits.map((e, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 rounded-full border bg-background px-4 py-1.5 text-[13px] font-semibold ${
                      e.target ? 'border-brand text-brand' : 'border-orange-400 text-orange-600'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{e.title}</span>
                    {e.target ? (
                      <span className="shrink-0 rounded bg-brand/15 px-1.5 py-0.5 font-mono text-[10.5px] font-normal italic">
                        {t('stage', { stage: e.target })}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {property ? (
              <p className="mt-3 text-[12.5px] text-muted-foreground">
                {t.rich('storedIn', {
                  property,
                  b: (chunks) => <b className="font-semibold text-foreground/80">{chunks}</b>,
                })}
              </p>
            ) : null}
            {variableNames(s.data).length > 0 ? (
              <p className="mt-2 flex flex-wrap gap-1">
                {variableNames(s.data).map((v) => (
                  <code
                    key={v}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-brand"
                  >
                    {v}
                  </code>
                ))}
              </p>
            ) : null}
          </button>
        ) : null}
        {!p.active ? (
          <div className="px-4 pb-4 empty:hidden">
            <StepPreview step={s} />
          </div>
        ) : null}
        {p.active ? (
          <div className="border-t border-border p-4">
            <StepEditor
              step={s}
              doc={p.doc}
              ctx={p.ctx}
              flowId={p.flowId}
              set={p.onSet}
              link={p.onLink}
            />
          </div>
        ) : null}
      </section>
      <div
        data-step-tools={s.id}
        className={`absolute start-full top-0 ms-2 hidden flex-col gap-0.5 rounded-xl border border-border bg-background p-1 text-muted-foreground shadow-md group-hover:lg:flex ${
          p.active ? 'lg:flex' : ''
        }`}
      >
        {tools()}
      </div>
      <Drawer
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={t('actions')}
        closeLabel={tShell('close')}
      >
        <p className="mb-3 text-[12.5px] text-muted-foreground">{t('actionsHint')}</p>
        <input
          type="search"
          value={actionQ}
          onChange={(e) => setActionQ(e.target.value)}
          placeholder={tSearch('search')}
          aria-label={tSearch('search')}
          className="mb-3 h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <div className="space-y-1">
          {p.actionKinds
            .filter((k) =>
              `${m(k.label)} ${m(k.help)}`.toLowerCase().includes(actionQ.trim().toLowerCase()),
            )
            .map((k) => {
              const look = lookOf(k.type);
              return (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => {
                    setActionsOpen(false);
                    p.onAddAction?.(k);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-start outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-lg"
                    style={{ background: look.bg, color: look.fg }}
                    aria-hidden="true"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className="size-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={look.icon} />
                    </svg>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium">{m(k.label)}</span>
                    <span className="block text-[12px] text-muted-foreground">{m(k.help)}</span>
                  </span>
                </button>
              );
            })}
        </div>
      </Drawer>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'delete' ? t('deleteTitle') : t('duplicateTitle')}
        message={confirm === 'delete' ? t('deleteBody') : t('duplicateBody')}
        confirmLabel={confirm === 'delete' ? t('deleteStep') : t('duplicate')}
        cancelLabel={tCommon('cancel')}
        tone={confirm === 'delete' ? 'danger' : 'default'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const what = confirm;
          setConfirm(null);
          if (what === 'delete') p.onDelete();
          else if (what === 'duplicate') p.onCopy();
        }}
      />
    </div>
  );
}

/** A 16px outline glyph from a path (the toolbar buttons). */
function Glyph({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-full hover:bg-muted disabled:opacity-30 ${
        danger ? 'hover:text-danger' : ''
      }`}
    >
      {children}
    </button>
  );
}
