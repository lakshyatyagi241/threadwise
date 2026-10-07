'use client';

import type { FlowEdge, FlowNode, FlbTemplateButtonRef } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { flowsApi } from '../../api/flows';
import { createSimulator, type LogEntry, type SimFile, type Simulator } from './simulator';

/** Files the operator can "send" to an Ask for file / image node: nothing is uploaded, the runtime only reads the name and type. */
export const SAMPLE_FILES: ReadonlyArray<{ id: string; file: SimFile }> = [
  { id: 'photo', file: { name: '', mime: 'image/jpeg', caption: 'photo' } },
  { id: 'png', file: { name: 'screenshot.png', mime: 'image/png' } },
  { id: 'pdf', file: { name: 'invoice.pdf', mime: 'application/pdf' } },
  { id: 'voice', file: { name: '', mime: 'audio/ogg' } },
  { id: 'exe', file: { name: 'setup.exe', mime: 'application/x-msdownload' } },
];
export const SAMPLE_LOCATION = {
  latitude: 12.9716,
  longitude: 77.5946,
  name: 'Test place',
  address: '1 MG Road, Bengaluru',
};

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

/** The tap targets under a Quick replies / List message. A tap sends that option as the customer's reply; once answered they go dim. */
function Choices({
  choices,
  live,
  onPick,
}: {
  choices: NonNullable<LogEntry['choices']>;
  live: boolean;
  onPick: (label: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const pill =
    'flex w-full items-center justify-center gap-1.5 rounded-md border border-[#0b8a73]/40 bg-white px-2 py-1.5 text-[12.5px] font-medium text-[#0b8a73] transition disabled:cursor-default disabled:opacity-50 enabled:hover:bg-[#0b8a73]/10';
  if (choices.kind === 'list') {
    return (
      <div className="mt-1.5 space-y-1 border-t border-black/10 pt-1.5" data-testid="choices-list">
        <button
          type="button"
          className={pill}
          disabled={!live}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <svg
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M3 4h10M3 8h10M3 12h10" strokeLinecap="round" />
          </svg>
          {choices.button || 'Choose'}
        </button>
        {open && live && (
          <ul className="max-h-44 overflow-y-auto rounded-md border border-black/10 bg-white">
            {choices.labels.map((l, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="w-full px-2.5 py-1.5 text-start text-[12.5px] hover:bg-black/5"
                  onClick={() => {
                    setOpen(false);
                    onPick(l);
                  }}
                >
                  {l}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <div className="mt-1.5 space-y-1 border-t border-black/10 pt-1.5" data-testid="choices-buttons">
      {choices.labels.map((l, i) => (
        <button key={i} type="button" className={pill} disabled={!live} onClick={() => onPick(l)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function LogBubble({
  entry,
  live = false,
  onPick,
}: {
  entry: LogEntry;
  /** This message is the one the run is waiting on, so its buttons can be tapped. */
  live?: boolean;
  onPick?: (label: string) => void;
}): ReactElement {
  if (entry.kind === 'system')
    return (
      <div className="py-1 text-center font-mono text-[10.5px] italic text-muted-foreground">
        {entry.text}
      </div>
    );
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
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 text-brand"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4 2h6l2 2v10H4zM6 6h4M6 9h4M6 12h3" />
            </svg>
            <span className="truncate">{media.filename || media.url.split('/').pop()}</span>
          </a>
        )
      ) : null}
      {entry.text ? (
        <div className="whitespace-pre-wrap px-1 text-[12.5px] leading-snug">
          {entry.choices ? entry.choices.prompt : entry.text}
        </div>
      ) : null}
      {entry.choices ? (
        <Choices
          choices={entry.choices}
          live={live && Boolean(onPick)}
          onPick={(l) => onPick?.(l)}
        />
      ) : null}
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
  /** What the run waits for from the operator: the node type of a media / location question, else plain text. */
  const [waitType, setWaitType] = useState<string | null>(null);
  const t = useTranslations('flb.builder.askMedia.test');
  const fileInput = useRef<HTMLInputElement>(null);
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
      onAwaiting: (a) => {
        setAwaiting(a);
        setWaitType(a ? (simRef.current?.current()?.type ?? null) : null);
      },
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
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Test runner
            </div>
            <div className="font-serif text-[15px] leading-tight">Simulate a chat</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={restart}
            className="px-1.5 text-[11px] font-semibold text-brand hover:underline"
          >
            Restart
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>
      <div
        ref={logRef}
        data-testid="test-log"
        className="flex flex-1 flex-col space-y-2 overflow-y-auto bg-muted/40 p-3"
      >
        {log.map((entry, i) => (
          <LogBubble
            key={i}
            entry={entry}
            live={awaiting && i === log.length - 1}
            onPick={(label) => simRef.current?.send(label)}
          />
        ))}
      </div>
      {awaiting && waitType === 'ask_file' ? (
        <div
          data-testid="test-file-actions"
          className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 pt-2.5 text-[11px]"
        >
          <span className="font-semibold text-muted-foreground">{t('sendFile')}</span>
          {SAMPLE_FILES.map((s) => (
            <button
              key={s.id}
              type="button"
              data-sample-file={s.id}
              onClick={() => simRef.current?.sendFile(s.file)}
              className="rounded-full border border-border bg-background px-2.5 py-1 hover:border-brand hover:text-brand"
            >
              {t(`file.${s.id}`)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="rounded-full border border-border bg-background px-2.5 py-1 hover:border-brand hover:text-brand"
          >
            {t('chooseFile')}
          </button>
          <input
            ref={fileInput}
            type="file"
            data-testid="test-file-input"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                simRef.current?.sendFile({
                  name: f.name,
                  mime: f.type || 'application/octet-stream',
                });
              e.target.value = '';
            }}
          />
        </div>
      ) : null}
      {awaiting && waitType === 'ask_location' ? (
        <div
          data-testid="test-location-actions"
          className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 pt-2.5 text-[11px]"
        >
          <span className="font-semibold text-muted-foreground">{t('sendLocation')}</span>
          <button
            type="button"
            data-sample-location="pin"
            onClick={() => simRef.current?.sendLocation(SAMPLE_LOCATION)}
            className="rounded-full border border-border bg-background px-2.5 py-1 hover:border-brand hover:text-brand"
          >
            {t('location.pin')}
          </button>
          <button
            type="button"
            data-sample-location="bare"
            onClick={() =>
              simRef.current?.sendLocation({
                latitude: SAMPLE_LOCATION.latitude,
                longitude: SAMPLE_LOCATION.longitude,
              })
            }
            className="rounded-full border border-border bg-background px-2.5 py-1 hover:border-brand hover:text-brand"
          >
            {t('location.bare')}
          </button>
        </div>
      ) : null}
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
