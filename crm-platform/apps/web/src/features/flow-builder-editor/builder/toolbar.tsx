'use client';

import Link from 'next/link';
import { Icon } from './node-card';

export type BuilderStatus = string;

interface Props {
  flowId: string | null;
  flowName: string;
  setFlowName: (v: string) => void;
  status: BuilderStatus;
  busy: boolean;
  onSave: () => void;
  onPublish: () => void;
  onTest: () => void;
  onAIGen: () => void;
}

/** The top bar: back arrow, editable name, Generate with AI, Test, the status pill, Save and Publish (TW-FLB-015). */
export function Toolbar({
  flowId,
  flowName,
  setFlowName,
  status,
  busy,
  onSave,
  onPublish,
  onTest,
  onAIGen,
}: Props) {
  const isPublished = status === 'Published';
  const isUnsaved = status.includes('unsaved');
  const label = isPublished ? 'Published' : isUnsaved ? 'Unsaved' : 'Draft';
  const dot = isPublished ? 'var(--flb-green)' : isUnsaved ? 'var(--flb-coral)' : '#92A29E';
  return (
    <header className="flow-toolbar relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <Link
        href="/flows"
        className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-muted"
        title="Back to flows"
        aria-label="Back to flows"
      >
        <Icon d="M10 4l-4 4 4 4" className="h-3.5 w-3.5" />
      </Link>
      <div className="flex min-w-0 items-center gap-2.5 py-1 pr-1 pl-1">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-brand text-brand-foreground">
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <circle cx="3.5" cy="8" r="1.6" />
            <circle cx="12.5" cy="3.5" r="1.6" />
            <circle cx="12.5" cy="12.5" r="1.6" />
            <path d="M5 7l6-3M5 9l6 3" />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="flow-eyebrow font-mono text-[9.5px] uppercase leading-none tracking-[0.16em] text-muted-foreground">
            Flow Builder
          </div>
          <input
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
            aria-label="Flow name"
            className="-ml-px w-[220px] border-0 bg-transparent px-0 py-0 font-serif text-[16px] leading-tight tracking-[-0.01em] outline-none"
          />
        </div>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onAIGen}
        title="Generate with AI"
        className="btn-ai-shine relative isolate inline-flex items-center gap-1.5 overflow-hidden rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
      >
        <Icon
          d="M8 1v3M8 12v3M1 8h3M12 8h3M3.5 3.5l2 2M10.5 10.5l2 2M3.5 12.5l2-2M10.5 5.5l2-2"
          className="h-3 w-3"
        />
        <span className="flow-ai-text">Generate with AI</span>
      </button>
      <button
        type="button"
        onClick={onTest}
        className="flow-test-btn inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11.5px] font-medium hover:bg-muted"
      >
        <Icon d="M5 3l8 5-8 5z" className="h-3 w-3" />
        <span className="flow-btn-text">Test</span>
      </button>
      <span
        className="flow-status inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[10.5px] font-medium text-[var(--flb-ink-700)]"
        title={label}
        role="status"
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
        {label}
      </span>
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="rounded-full border border-border bg-background px-3 py-1.5 text-[11.5px] font-medium hover:bg-muted disabled:opacity-60"
      >
        <span className="flow-save-full">{flowId ? 'Save changes' : 'Save'}</span>
        <span className="flow-save-short">Save</span>
      </button>
      <button
        type="button"
        onClick={onPublish}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-[11.5px] font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-60"
      >
        <Icon d="M2 8l5 5 7-9" className="h-3 w-3" />
        Publish
      </button>
    </header>
  );
}
