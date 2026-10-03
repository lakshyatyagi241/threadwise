'use client';

import { useState } from 'react';
import type { FlbAiGenerateResponse, FlbBuilderContext, FlowType } from '@crm/contracts';
import { flowsApi } from '../api/flows';
import { aiGenerateError } from './ai-generate-error';
import { Icon } from './node-card';

const Spinner = () => (
  <svg
    className="h-3.5 w-3.5 animate-spin"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="8" cy="8" r="6" strokeDasharray="20 8" />
  </svg>
);

const Backdrop = ({
  onClose,
  disabled,
  children,
}: {
  onClose: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) => (
  <div
    onClick={(e) => {
      if (e.target === e.currentTarget && !disabled) onClose();
    }}
    className="fixed inset-0 z-50 flex items-center justify-center p-5"
    style={{ background: 'rgba(11,31,28,0.46)' }}
    role="presentation"
  >
    {children}
  </div>
);

const CloseButton = ({ onClose, disabled }: { onClose: () => void; disabled?: boolean }) => (
  <button
    type="button"
    onClick={onClose}
    disabled={disabled}
    aria-label="Close"
    className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-muted disabled:opacity-40"
  >
    <Icon d="M4 4l8 8M12 4l-8 8" className="h-3.5 w-3.5" />
  </button>
);

/** Save of a flow with no id yet: confirm the name first, then the real POST. */
export function SaveConfirmModal(props: {
  open: boolean;
  initialName: string;
  busy: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  // Mounted only while open, so the field starts from the current name every time.
  return props.open ? <SaveConfirmInner {...props} /> : null;
}

function SaveConfirmInner({
  initialName,
  busy,
  onSave,
  onClose,
}: {
  initialName: string;
  busy: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    onSave(trimmed);
  };
  return (
    <Backdrop onClose={onClose} disabled={busy}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Save flow"
        className="w-full max-w-[460px] rounded-2xl border border-border bg-background shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Save flow
            </div>
            <h3 className="font-serif text-[20px] leading-tight tracking-[-0.01em]">
              Confirm name, then save
            </h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Saving keeps your nodes + edges as a draft. Publish separately when you&apos;re ready
              to run it.
            </p>
          </div>
          <CloseButton onClose={onClose} disabled={busy} />
        </div>
        <div className="space-y-3 px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold text-foreground/80">
              Flow name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              autoFocus
              placeholder="e.g. Welcome flow"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-[12px] hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-[12px] font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Spinner /> : <Icon d="M2 8l5 5 7-9" className="h-3 w-3" />}
            {busy ? 'Saving…' : 'Save flow'}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

const PROVIDER_META: Record<string, { label: string; dot: string }> = {
  openai: { label: 'OpenAI', dot: '#10A37F' },
  anthropic: { label: 'Anthropic', dot: '#D97757' },
  gemini: { label: 'Google', dot: '#4285F4' },
  mistral: { label: 'Mistral', dot: '#FA520F' },
};
const EXAMPLES = [
  'Customer support bot with name, email collection',
  'Order tracking with order number verification',
  'Lead qualification bot with budget questions',
  'Appointment booking with date and time selection',
];

type Model = FlbBuilderContext['aiModels'][number];

/** "Generate a flow with AI": pick a model, describe the flow, replace the canvas with what comes back (TW-FLB-025). */
export function AIGenModal({
  open,
  models,
  initialPrompt,
  flowType,
  onClose,
  onGenerate,
}: {
  open: boolean;
  models: Model[];
  initialPrompt: string;
  flowType: FlowType;
  onClose: () => void;
  onGenerate: (flow: FlbAiGenerateResponse['flow'], modelLabel: string) => void;
}) {
  return open ? (
    <AIGenInner
      models={models}
      initialPrompt={initialPrompt}
      flowType={flowType}
      onClose={onClose}
      onGenerate={onGenerate}
    />
  ) : null;
}

function AIGenInner({
  models,
  initialPrompt,
  flowType,
  onClose,
  onGenerate,
}: {
  models: Model[];
  initialPrompt: string;
  flowType: FlowType;
  onClose: () => void;
  onGenerate: (flow: FlbAiGenerateResponse['flow'], modelLabel: string) => void;
}) {
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The first model is the default until one is picked; the modal is mounted fresh each time it opens.
  const entry = models.find((m) => m.value === model) ?? models[0];

  const generate = async () => {
    if (!prompt.trim() || !entry) return;
    setError(null);
    setLoading(true);
    try {
      const res = await flowsApi.aiGenerate({
        prompt: prompt.trim(),
        model: entry.value,
        provider: entry.provider as 'openai' | 'anthropic' | 'gemini',
        flowType,
      });
      onGenerate(res.flow, entry.label || entry.value);
      setPrompt('');
      onClose();
    } catch (e) {
      setError(aiGenerateError(e));
    } finally {
      setLoading(false);
    }
  };

  const cols =
    models.length >= 3 ? 'grid-cols-3' : models.length === 2 ? 'grid-cols-2' : 'grid-cols-1';
  return (
    <Backdrop onClose={onClose} disabled={loading}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Generate a flow with AI"
        className="flex max-h-[88vh] w-full max-w-[640px] flex-col rounded-2xl border border-border bg-background shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              AI Flow Generator
            </div>
            <h3 className="font-serif text-[22px] leading-tight tracking-[-0.01em]">
              Generate a flow with AI
            </h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Pick a model, describe what you want, and AI will build the nodes.
            </p>
          </div>
          <CloseButton onClose={onClose} disabled={loading} />
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-[11.5px] font-semibold text-foreground/80">
              Choose model
            </label>
            {models.length === 0 ? (
              <div className="rounded-lg border border-border bg-muted px-3 py-3 text-[12px] text-foreground/80">
                No AI providers enabled. Admin needs to add a key in{' '}
                <a href="/admin/api-keys" className="text-brand underline">
                  AI Keys
                </a>{' '}
                before this can run.
              </div>
            ) : (
              <div className={`grid gap-2 ${cols}`}>
                {models.map((m) => {
                  const meta = PROVIDER_META[m.provider];
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setModel(m.value)}
                      aria-pressed={entry?.value === m.value}
                      className={`flex flex-col items-start gap-1 rounded-xl border p-3 transition ${entry?.value === m.value ? 'border-brand bg-[color-mix(in_srgb,var(--flb-mint)_30%,transparent)]' : 'border-border bg-background hover:bg-muted'}`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: meta?.dot ?? '#888' }}
                        />
                        <span className="truncate text-[12.5px] font-semibold">
                          {m.label.split(' · ')[1] ?? m.label}
                        </span>
                      </span>
                      <span className="text-[10.5px] text-muted-foreground">
                        {meta?.label ?? m.provider}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-[var(--flb-coral)]/30 bg-[var(--flb-coral)]/10 px-3 py-2 text-[12px] text-[var(--flb-coral)]"
            >
              {error}
            </div>
          ) : null}
          <div>
            <label className="mb-1.5 block text-[11.5px] font-semibold text-foreground/80">
              Describe your flow
            </label>
            <textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Example: Create a customer support bot that asks for user name, email, and issue type, then sends a confirmation message…"
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            />
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-foreground/80">
              Quick examples
            </div>
            <div className="space-y-1">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPrompt(ex)}
                  className="inline-flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-left text-[11.5px] text-foreground/80 hover:bg-muted"
                >
                  <Icon d="M3 8l3 3 7-7" className="h-3 w-3 text-brand" />
                  <span className="truncate">{ex}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border bg-muted/40 px-5 py-3">
          <div className="text-[10.5px] text-muted-foreground">
            {loading ? 'Generating…' : 'AI will replace the current flow.'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-[12px] hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={loading || !prompt.trim() || !entry}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#7B57C7,#3D7CD3)' }}
            >
              {loading ? <Spinner /> : <Icon d="M8 1v3M8 12v3M1 8h3M12 8h3" className="h-3 w-3" />}
              Generate
            </button>
          </div>
        </div>
      </div>
    </Backdrop>
  );
}
