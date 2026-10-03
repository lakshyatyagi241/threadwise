'use client';

import type { FlowEdge, FlowNode, FlbTemplateButtonRef } from '@crm/contracts';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { flowsApi } from '../../api/flows';
import { createSimulator, type LogEntry, type Simulator } from './simulator';

export interface TestPanelProps {
  open: boolean;
  onClose: () => void;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Bump to restart the run (the toolbar Test button). 0 = never started: a panel opened by `?test=1` stays empty until Restart. */
  runNonce: number;
  templateButtons?: (node: FlowNode) => FlbTemplateButtonRef[];
  flowName?: (id: string) => string | undefined;
}

export function LogBubble({ entry }: { entry: LogEntry }): ReactElement {
  if (entry.kind === 'system')
    return <div className="py-1 text-center font-mono text-[10.5px] italic text-muted-foreground">{entry.text}</div>;
  if (entry.kind === 'user')
    return (
      <div className="max-w-[80%] self-end whitespace-pre-wrap rounded-lg rounded-br-[4px] bg-[var(--flb-mint)] px-3 py-2 text-[#0b1f1c] text-[12.5px] leading-snug">
        {entry.text}
      </div>
    );
  const media = entry.media;
  return (
    <div className="flex max-w-[80%] flex-col gap-1.5 self-start rounded-lg rounded-bl-[4px] border border-border bg-background px-2.5 py-2">
      {media?.url ? (
        media.kind === 'image' ? (
          <img
            src={media.url}
            alt={media.filename}
            className="max-h-[200px] w-auto rounded bg-muted object-contain"
            onError={(e) => void (e.currentTarget.style.display = 'none')}
          />
        ) : media.kind === 'video' ? (
          <video src={media.url} controls className="max-h-[220px] w-full rounded bg-muted" />
        ) : media.kind === 'audio' ? (
          <audio src={media.url} controls className="w-full" />
        ) : (
          <a
            href={media.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded border border-border bg-muted px-2.5 py-2 text-[11.5px] text-foreground no-underline hover:bg-muted/70"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-brand" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 2h6l2 2v10H4zM6 6h4M6 9h4M6 12h3" />
            </svg>
            <span className="truncate">{media.filename || media.url.split('/').pop()}</span>
          </a>
        )
      ) : null}
      {entry.text ? <div className="whitespace-pre-wrap px-1 text-[12.5px] leading-snug">{entry.text}</div> : null}
    </div>
  );
}

export function TestPanel({
  open,
  onClose,
  nodes,
  edges,
  runNonce,
  templateButtons,
  flowName,
}: TestPanelProps): ReactElement | null {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [awaiting, setAwaiting] = useState(false);
  const [val, setVal] = useState('');
  const simRef = useRef<Simulator | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // The run reads the graph as it was when it started; keep the latest in refs so Restart picks up edits.
  const latest = useRef({ nodes, edges, templateButtons, flowName });
  useEffect(() => {
    latest.current = { nodes, edges, templateButtons, flowName };
  });

  const restart = useCallback(() => {
    simRef.current?.stop();
    const g = latest.current;
    const sim = createSimulator({
      nodes: g.nodes,
      edges: g.edges,
      templateButtons: g.templateButtons,
      flowName: g.flowName,
      callWebhook: (req) => flowsApi.testWebhook(req),
      onLog: (e) => setLog((prev) => prev.concat(e)),
      onReset: () => setLog([]),
      onAwaiting: setAwaiting,
    });
    simRef.current = sim;
    setVal('');
    sim.start();
  }, []);

  useEffect(() => {
    // `runNonce` 0 is a panel opened by `?test=1`: it waits, empty, for Restart (WaDesk quirk).
    if (!open || runNonce === 0) return;
    // Starting the run resets the transcript; the simulator is an external system that this effect synchronises with.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    restart();
    return () => simRef.current?.stop();
  }, [open, runNonce, restart]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  if (!open) return null;

  const send = () => {
    if (!val.trim() || !awaiting) return;
    simRef.current?.send(val);
    setVal('');
  };

  return (
    <div
      role="dialog"
      aria-label="Test runner"
      className="fixed bottom-6 right-6 z-40 flex max-h-[65vh] w-[380px] flex-col rounded-2xl border border-border bg-background shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand/15 text-brand">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
              <path d="M5 3l8 5-8 5z" />
            </svg>
          </span>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Test runner</div>
            <div className="font-serif text-[15px] leading-tight">Simulate a chat</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={restart} className="px-1.5 text-[11px] font-semibold text-brand hover:underline">
            Restart
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>
      <div ref={logRef} data-testid="test-log" className="flex flex-1 flex-col space-y-2 overflow-y-auto bg-muted/40 p-3">
        {log.map((entry, i) => (
          <LogBubble key={i} entry={entry} />
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-border p-3">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder={awaiting ? 'Type a reply…' : 'Waiting for bot…'}
          disabled={!awaiting}
          className="flex-1 rounded-full border border-border bg-background px-3 py-2 text-[12.5px] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-muted"
        />
        <button
          type="button"
          onClick={send}
          disabled={!awaiting}
          className="rounded-full bg-brand px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
