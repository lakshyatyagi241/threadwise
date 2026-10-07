'use client';

import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FlbBuilderContext, FlowDetail } from '@crm/contracts';
import { Badge, Button, ConfirmDialog, Field, Input, Select, useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { flowsApi } from '../../api/flows';
import { FLB_KEYS, useBuilderContext } from '../../api/hooks';
import {
  BRANCHING,
  STEP_KINDS,
  stepLabel,
  addJourney,
  allSteps,
  duplicateStep,
  emptyDoc,
  groupIndexOf,
  groupsOf,
  insertStep,
  moveStep,
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
import { BuilderFonts } from '../builder-fonts';
import { LinkSelect, NEW_JOURNEY, StepEditor } from './step-editors';
import '../builder.css';

const errMessage = (e: unknown): string =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * The Simple flow builder (an addition beyond Reference, switched on in Admin > Project settings > Flow builder). A flow is a list of
 * steps one under another, grouped in flows ("journeys") like the console's bot builder; a button or list row leads to any step.
 * It saves the same graph the Advanced canvas does, through the same API, so a flow runs the same and opens in either builder.
 */
export function SimpleScreen({ flowId: initialFlowId }: { flowId?: string }) {
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
        Loading the flow…
      </div>
    );
  }
  return (
    <SimpleInner
      key={initialFlowId ?? 'new'}
      initial={flowQuery.data ?? null}
      ctx={ctx}
      advancedAllowed={overview.data?.builderMode !== 'simple'}
    />
  );
}

function SimpleInner({
  initial,
  ctx,
  advancedAllowed,
}: {
  initial: FlowDetail | null;
  ctx: FlbBuilderContext;
  advancedAllowed: boolean;
}) {
  const { toast } = useToast();
  const parsed = useMemo(() => {
    if (!initial) {
      const d = emptyDoc();
      // One connected number: pick it for them.
      const only = ctx.senders.chat.length === 1 ? ctx.senders.chat[0]! : null;
      if (only) d.trigger.data.deviceId = only.key;
      return { ok: true as const, doc: d };
    }
    if (initial.flowType !== 'chat')
      return { ok: false as const, reasons: [`It is a ${initial.flowType} flow.`] };
    return toSimple(initial.graph);
  }, [initial, ctx.senders.chat]);

  if (!parsed.ok) {
    return (
      <div className="flb-root fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-muted p-6 text-foreground">
        <BuilderFonts />
        <div className="w-full max-w-lg rounded-2xl border border-border bg-background p-6">
          <h1 className="font-serif text-[22px]">This flow needs the Advanced builder</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            The Simple builder shows a flow as steps one under another. This one uses something that
            does not fit that:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px]">
            {parsed.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className="mt-5 flex gap-2">
            <Link
              href="/flows"
              className="rounded-full border border-border px-4 py-2 text-[12px] font-medium hover:bg-muted"
            >
              Back to flows
            </Link>
            {advancedAllowed && initial ? (
              <Link
                href={`/flows/builder/${initial.id}`}
                className="rounded-full bg-brand px-4 py-2 text-[12px] font-semibold text-brand-foreground"
              >
                Open in Advanced
              </Link>
            ) : (
              <p className="self-center text-[12px] text-muted-foreground">
                The Advanced builder is switched off for this workspace; ask your administrator.
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
      ctx={ctx}
      advancedAllowed={advancedAllowed}
      toast={toast}
    />
  );
}

function Editor({
  initialDoc,
  initial,
  ctx,
  advancedAllowed,
  toast,
}: {
  initialDoc: SimpleDoc;
  initial: FlowDetail | null;
  ctx: FlbBuilderContext;
  advancedAllowed: boolean;
  toast: (m: string, tone?: 'success' | 'danger' | 'info') => number;
}) {
  const [doc, setDoc] = useState<SimpleDoc>(initialDoc);
  const [name, setName] = useState(initial?.name ?? 'New flow');
  const [flowId, setFlowId] = useState<string | null>(initial?.id ?? null);
  const [rowVersion, setRowVersion] = useState(initial?.rowVersion ?? 1);
  const [published, setPublished] = useState(initial?.isPublished ?? false);
  const [dirty, setDirty] = useState(!initial);
  const [busy, setBusy] = useState(false);
  const [gi, setGi] = useState(0);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<{
    doc: SimpleDoc;
    name: string | null;
    notes: string[];
  } | null>(null);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const [importFailed, setImportFailed] = useState<string[]>([]);

  const change = useCallback((next: SimpleDoc) => {
    setDoc(next);
    setDirty(true);
  }, []);

  const senderRequired = ctx.senders.chat.length > 0;
  // What stops a publish.
  const found = useMemo(() => problems(doc, { senderRequired }), [doc, senderRequired]);
  // Parts nothing leads to: they would never run, but they harm nothing, so they only warn (an imported flow has many).
  const notReached = useMemo(
    () =>
      unreachable(doc).map((s) => ({
        stepId: s.id,
        message: `"${stepSummary(s) || stepLabel(s)}" (step ${stageIn(
          doc,
          doc.journeys.findIndex((j) => j.steps[0]?.id === s.id),
          0,
        )}) starts a part nothing leads to, so it never runs.`,
      })),
    [doc],
  );
  const [showUnreached, setShowUnreached] = useState(false);
  const openStep = (stepId: string | null) => {
    if (stepId) {
      const at = doc.journeys.findIndex((j) => j.steps.some((s) => s.id === stepId));
      if (at >= 0) setGi(groupIndexOf(doc, at));
      setActiveId(stepId);
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

  const setData = (id: string, patch: Record<string, unknown>) =>
    change(updateStep(doc, id, { data: patch }));

  const link = (id: string, i: number, target: string | null) => {
    const step = allSteps(doc).find((s) => s.id === id);
    if (!step) return;
    let next = doc;
    let to = target;
    if (target === NEW_JOURNEY) {
      const first = newStep('message', allSteps(doc));
      next = addJourney(next, first);
      to = first.id;
      setGi(groupsOf(next).length - 1);
      setActiveId(first.id);
    }
    const links = step.links.slice();
    links[i] = to;
    change(updateStep(next, id, { links }));
  };

  /** Where the last step of a part carries on (a "node to node" connection). */
  const setGoto = (id: string, target: string | null) => {
    let next = doc;
    let to = target;
    if (target === NEW_JOURNEY) {
      const first = newStep('message', allSteps(doc));
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
  const finishImport = (imp: { doc: SimpleDoc; name: string | null; notes: string[] }) => {
    const next = applyImport(doc, imp.doc);
    change(next);
    setGi(0);
    setActiveId(null);
    if (imp.name && (name.trim() === '' || name === 'New flow')) setName(imp.name);
    setImportFailed([]);
    setImportNotes(imp.notes);
    const steps = allSteps(next).length;
    toast(
      `Imported ${steps} step${steps === 1 ? '' : 's'} in ${groupsOf(next).length} flow${groupsOf(next).length === 1 ? '' : 's'}. Check them, then Save.`,
      'success',
    );
  };

  const onImportFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setImportNotes([]);
      setImportFailed(['That file is not valid JSON.']);
      return;
    }
    const res = importToSimple(raw);
    if (!res.ok) {
      setImportNotes([]);
      setImportFailed(res.reasons);
      return;
    }
    if (allSteps(doc).length > 0) setPendingImport(res);
    else finishImport(res);
  };

  // --- save / publish -------------------------------------------------------------------------------------------------
  const payload = () => {
    const g = toGraph(doc);
    return {
      name: name.trim() || 'New flow',
      category: initial?.category ?? null,
      flowType: 'chat' as const,
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
      toast(`Saved "${saved.name}"`, 'success');
    } catch (e) {
      toast(`Save failed: ${errMessage(e)}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const onPublish = async () => {
    if (busy) return;
    if (found.length > 0) {
      setShowProblems(true);
      return;
    }
    setBusy(true);
    try {
      const saved = dirty || !flowId ? await persist() : null;
      const pub = await flowsApi.publish(saved?.id ?? flowId!);
      setRowVersion(pub.rowVersion);
      setPublished(true);
      toast('Published', 'success');
    } catch (e) {
      toast(`Publish failed: ${errMessage(e)}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const status = published
    ? dirty
      ? 'Published · unsaved changes'
      : 'Published'
    : dirty
      ? 'Draft · unsaved'
      : 'Draft';

  return (
    <div className="flb-root fixed inset-0 z-40 flex flex-col bg-muted text-foreground">
      <BuilderFonts />
      <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
        <Link
          href="/flows"
          aria-label="Back to flows"
          title="Back to flows"
          className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-muted"
        >
          ←
        </Link>
        <input
          aria-label="Flow name"
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
        <Badge>Simple builder</Badge>
        <div className="ml-auto flex items-center gap-2">
          {found.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowProblems((v) => !v)}
              className="rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-[12px] font-medium text-warning"
            >
              {found.length} to fix
            </button>
          ) : null}
          {notReached.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowUnreached((v) => !v)}
              className="rounded-full border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted"
              title="Parts of flows that no button or list row leads to. They do not stop you publishing."
            >
              {notReached.length} not reached
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
            title="Import a flow from a .json file: this app's export or a wabo console export"
          >
            Import
          </button>
          {advancedAllowed && flowId ? (
            <Link
              href={`/flows/builder/${flowId}`}
              className="hidden rounded-full border border-border px-3 py-1.5 text-[12px] font-medium hover:bg-muted sm:block"
              title="Open this flow on the canvas"
            >
              Open in Advanced
            </Link>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !dirty}
            onClick={() => void onSave()}
          >
            Save
          </Button>
          <Button variant="brand" size="sm" disabled={busy} onClick={() => void onPublish()}>
            {published ? 'Publish changes' : 'Publish'}
          </Button>
        </div>
      </header>

      {importFailed.length > 0 ? (
        <div
          role="alert"
          className="shrink-0 border-b border-danger/30 bg-danger/10 px-4 py-2 text-[12.5px]"
        >
          <div className="mb-1 flex items-center justify-between font-medium">
            <span>That file could not be imported:</span>
            <button
              type="button"
              className="text-[12px] underline"
              onClick={() => setImportFailed([])}
            >
              Dismiss
            </button>
          </div>
          <ul className="list-disc space-y-0.5 pl-5">
            {importFailed.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {importNotes.length > 0 ? (
        <div className="shrink-0 border-b border-border bg-background px-4 py-2 text-[12.5px]">
          <div className="mb-1 flex items-center justify-between font-medium">
            <span>Imported. A few things did not come across:</span>
            <button
              type="button"
              className="text-[12px] underline"
              onClick={() => setImportNotes([])}
            >
              Dismiss
            </button>
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {importNotes.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {showProblems && found.length > 0 ? (
        <div className="shrink-0 border-b border-warning/30 bg-warning/10 px-4 py-2 text-[12.5px]">
          <div className="mb-1 font-medium">Fix these before publishing:</div>
          <ul className="list-disc space-y-0.5 pl-5">
            {found.map((p, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="text-left underline-offset-2 hover:underline"
                  onClick={() => openStep(p.stepId)}
                >
                  {p.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showUnreached && notReached.length > 0 ? (
        <div className="max-h-40 shrink-0 overflow-y-auto border-b border-border bg-background px-4 py-2 text-[12.5px]">
          <div className="mb-1 flex items-center justify-between font-medium">
            <span>Not reached: link a button or list row to them, or delete them.</span>
            <button
              type="button"
              className="text-[12px] underline"
              onClick={() => setShowUnreached(false)}
            >
              Hide
            </button>
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {notReached.map((p) => (
              <li key={p.stepId}>
                <button
                  type="button"
                  className="text-left underline-offset-2 hover:underline"
                  onClick={() => openStep(p.stepId)}
                >
                  {p.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-background md:flex">
          <div className="flex items-center justify-between px-4 pt-3">
            <span className="text-[15px] font-semibold">Flows</span>
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
              + New Flow
            </button>
          </div>
          <div className="px-4 py-3">
            <Input
              aria-label="Search flows"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Flows">
            {groups.map((g, i) => {
              if (query.trim() && !g.name.toLowerCase().includes(query.trim().toLowerCase()))
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
                    className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-[13px]"
                  >
                    <span className="w-5 shrink-0 text-right font-mono text-[12px] text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    {lost ? (
                      <span title="Nothing leads to this flow yet" className="text-warning">
                        !
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    aria-label={`Duplicate ${g.name}`}
                    title="Duplicate this flow"
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
                  <span className="w-6 shrink-0 text-right font-mono text-[12px] text-muted-foreground">
                    {String(g.steps).padStart(2, '0')}
                  </span>
                </div>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-xl px-4 py-6">
            <div className="mb-4 flex flex-wrap items-center gap-2 md:hidden">
              <Select
                aria-label="Flow"
                value={gIndex}
                onChange={(e) => {
                  setGi(Number(e.target.value));
                  setActiveId(null);
                }}
                className="h-9 flex-1"
              >
                {groups.map((g, i) => (
                  <option key={g.key} value={i}>
                    {i + 1}. {g.name}
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
                + New flow
              </Button>
            </div>

            <div className="mb-4 flex items-end gap-2">
              <Field label="Flow name" className="flex-1" eyebrow>
                <Input
                  value={group.name}
                  placeholder={`Flow ${gIndex + 1}`}
                  onChange={(e) => change(renameGroup(doc, gIndex, e.target.value))}
                />
              </Field>
              {gIndex > 0 ? (
                <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(gIndex)}>
                  Delete flow
                </Button>
              ) : null}
            </div>

            {gIndex === 0 ? (
              <TriggerCard
                doc={doc}
                ctx={ctx}
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
                      Another part of this flow. It runs when a button or list row leads here
                      {lostPart ? ': nothing leads here yet, so it would never run.' : '.'}
                    </p>
                  ) : null}
                  <AddMenu
                    onPick={(k) => add(ci, 0, k)}
                    atEnd={journey.steps.length === 0}
                    hint={journey.steps.length === 0 ? 'Add the first step' : undefined}
                  />
                  {journey.steps.map((s, si) => (
                    <div key={s.id}>
                      <StepCard
                        step={s}
                        doc={doc}
                        ctx={ctx}
                        stage={stageIn(doc, ci, si)}
                        active={activeId === s.id}
                        bad={badSteps.has(s.id)}
                        first={si === 0}
                        last={si === journey.steps.length - 1}
                        onToggle={() => setActiveId(activeId === s.id ? null : s.id)}
                        onSet={(patch) => setData(s.id, patch)}
                        onLink={(i, t) => link(s.id, i, t)}
                        onMove={(d) => change(moveStep(doc, s.id, d))}
                        onCopy={() => change(duplicateStep(doc, s.id))}
                        onDelete={() => {
                          change(removeStep(doc, s.id));
                          setActiveId(null);
                        }}
                      />
                      {BRANCHING.has(s.type) ? (
                        <p className="my-3 text-center text-[11.5px] text-muted-foreground">
                          This {s.type === 'list' ? 'list' : 'set of buttons'} ends this part: what
                          is sent next depends on what the customer picks.
                        </p>
                      ) : (
                        <>
                          <AddMenu
                            onPick={(k) => add(ci, si + 1, k)}
                            atEnd={si === journey.steps.length - 1}
                          />
                          {si === journey.steps.length - 1 ? (
                            <div className="mb-3 flex items-center gap-2">
                              <span className="shrink-0 text-[12px] text-muted-foreground">
                                Then go to
                              </span>
                              <div className="min-w-0 flex-1">
                                <LinkSelect
                                  doc={doc}
                                  stepId={s.id}
                                  value={s.goto ?? null}
                                  onChange={(t) => setGoto(s.id, t)}
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

      <ConfirmDialog
        open={pendingImport !== null}
        title="Replace this flow with the file?"
        message="The steps here are replaced by the ones in the file. The WhatsApp number and trigger words stay. Nothing is saved until you press Save."
        confirmLabel="Replace"
        cancelLabel="Cancel"
        tone="danger"
        onClose={() => setPendingImport(null)}
        onConfirm={() => {
          if (pendingImport) finishImport(pendingImport);
          setPendingImport(null);
        }}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete this flow?"
        message="Its steps are removed, and any button that led to it ends the conversation instead."
        confirmLabel="Delete flow"
        cancelLabel="Cancel"
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
  );
}

function TriggerCard({
  doc,
  ctx,
  set,
  bad,
}: {
  doc: SimpleDoc;
  ctx: FlbBuilderContext;
  set: (patch: Record<string, unknown>) => void;
  bad: boolean;
}) {
  const d = doc.trigger.data;
  const kind = str(d.kind) || 'keyword';
  const any = str(d.keywordMode) === 'any';
  return (
    <section
      className={`rounded-2xl border bg-background p-4 ${bad ? 'border-danger' : 'border-border'}`}
      aria-label="Trigger"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-brand/10 text-brand">
          ▶
        </span>
        <div className="font-semibold">When does this flow start?</div>
      </div>
      {kind !== 'keyword' ? (
        <p className="mb-3 rounded-lg bg-muted p-2.5 text-[12.5px] text-muted-foreground">
          This flow starts on &ldquo;{kind.replace(/_/g, ' ')}&rdquo;. Change that in the Advanced
          builder; the number it runs on can be set here.
        </p>
      ) : (
        <div className="space-y-3">
          <Field label="Starts when the customer sends">
            <Select
              value={any ? 'any' : 'keywords'}
              onChange={(e) => set({ keywordMode: e.target.value })}
            >
              <option value="keywords">One of these words</option>
              <option value="any">Any message</option>
            </Select>
          </Field>
          {!any ? (
            <Field label="Words" hint="Separate with commas. Capital letters do not matter.">
              <Input
                value={str(d.keywords)}
                placeholder="hi, hello, menu"
                onChange={(e) => set({ keywords: e.target.value })}
              />
            </Field>
          ) : null}
        </div>
      )}
      <Field
        className="mt-3"
        label="WhatsApp number"
        hint={
          ctx.senders.chat.length === 0
            ? 'No WhatsApp number is connected yet: connect one under Settings, then pick it here.'
            : undefined
        }
      >
        <Select value={str(d.deviceId)} onChange={(e) => set({ deviceId: e.target.value })}>
          <option value="">Choose a number…</option>
          {ctx.senders.chat.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
              {s.phone ? ` · ${s.phone}` : ''}
            </option>
          ))}
        </Select>
      </Field>
    </section>
  );
}

function AddMenu({
  onPick,
  atEnd,
  hint,
}: {
  onPick: (k: StepKind) => void;
  atEnd: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative my-2 flex flex-col items-center">
      <div className="h-3 w-px bg-border" />
      <button
        type="button"
        aria-label={hint ?? 'Add a step'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`grid place-items-center rounded-full border border-border bg-background text-brand shadow-sm hover:bg-muted ${
          hint
            ? 'h-auto gap-1 px-4 py-2 text-[12.5px] font-semibold'
            : 'h-8 w-8 text-lg leading-none'
        }`}
      >
        {hint ? `+ ${hint}` : '+'}
      </button>
      <div className="h-3 w-px bg-border" />
      {open ? (
        <div
          role="menu"
          className="absolute top-12 z-20 max-h-[70vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-2 shadow-xl"
        >
          {(['send', 'ask', 'handoff'] as const).map((group) => (
            <div key={group} className="mb-1 last:mb-0">
              <div className="px-2.5 pt-1.5 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {group === 'send' ? 'Send' : group === 'ask' ? 'Ask the customer' : 'Hand off'}
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {STEP_KINDS.filter((k) => k.group === group).map((k) => {
                  const blocked = BRANCHING.has(k.type) && !atEnd;
                  return (
                    <button
                      key={k.key}
                      type="button"
                      role="menuitem"
                      disabled={blocked}
                      title={
                        blocked
                          ? 'Buttons and lists end a flow, so they can only go last.'
                          : undefined
                      }
                      onClick={() => {
                        setOpen(false);
                        onPick(k);
                      }}
                      className="rounded-xl p-2.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <div className="text-[13px] font-semibold">{k.label}</div>
                      <div className="text-[11.5px] text-muted-foreground">{k.help}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StepCard(p: {
  step: SimpleStep;
  doc: SimpleDoc;
  ctx: FlbBuilderContext;
  stage: string;
  active: boolean;
  bad: boolean;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onSet: (patch: Record<string, unknown>) => void;
  onLink: (i: number, target: string | null) => void;
  onMove: (dir: -1 | 1) => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const { step: s } = p;
  const stageOf = (id: string | null) => {
    if (!id) return null;
    for (let a = 0; a < p.doc.journeys.length; a++) {
      const b = p.doc.journeys[a]!.steps.findIndex((x) => x.id === id);
      if (b >= 0) return stageIn(p.doc, a, b);
    }
    return null;
  };
  const labels: string[] = BRANCHING.has(s.type)
    ? (Array.isArray(s.data.options) ? s.data.options : []).map((o: unknown, i: number) => {
        const t = typeof o === 'string' ? o : str((o as Record<string, unknown>).title);
        const to = stageOf(s.links[i] ?? null);
        return `${t || `#${i + 1}`} → ${to ?? 'ends'}`;
      })
    : [];
  return (
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
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="rounded-full bg-brand/10 px-2 py-0.5 font-mono text-[11px] text-brand">
            {p.stage}
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">{stepLabel(s)}</span>
            <span className="block truncate text-[12px] text-muted-foreground">
              {stepSummary(s) || 'Empty'}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
          <IconBtn label="Move up" disabled={p.first} onClick={() => p.onMove(-1)}>
            ↑
          </IconBtn>
          <IconBtn label="Move down" disabled={p.last} onClick={() => p.onMove(1)}>
            ↓
          </IconBtn>
          {!BRANCHING.has(s.type) ? (
            <IconBtn label="Duplicate" onClick={p.onCopy}>
              ⧉
            </IconBtn>
          ) : null}
          <IconBtn label="Delete step" danger onClick={p.onDelete}>
            ✕
          </IconBtn>
        </div>
      </div>
      {!p.active && labels.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-3 pb-3">
          {labels.map((l, i) => (
            <span key={i} className="rounded-full bg-muted px-2.5 py-1 text-[11.5px]">
              {l}
            </span>
          ))}
        </div>
      ) : null}
      {p.active ? (
        <div className="border-t border-border p-4">
          <StepEditor step={s} doc={p.doc} ctx={p.ctx} set={p.onSet} link={p.onLink} />
        </div>
      ) : null}
    </section>
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
