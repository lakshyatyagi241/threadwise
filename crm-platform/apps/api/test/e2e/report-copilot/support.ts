import { randomUUID } from 'node:crypto';

export type SseEvent = Record<string, unknown> & { type: string };

/** The `data:` frames of a Server-Sent Events body, parsed. */
export function parseSse(body: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const frame of body.split(/\n\n+/)) {
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('');
    if (!data) continue;
    try {
      out.push(JSON.parse(data) as SseEvent);
    } catch {
      /* a keep-alive comment or a partial frame */
    }
  }
  return out;
}

export type Step = string | [string, Record<string, unknown>];

export interface SeenPrompt {
  system: string;
  toolNames: string[];
  toolDescriptions: Record<string, string>;
}

const USAGE = {
  inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 30, text: 30, reasoning: 0 },
};

const SANDBOX_UI = {
  initialHeight: 480,
  placeholderMessages: ['Designing the report...'],
  css: '.kpi{padding:8px;border:1px solid #ddd}',
  html: '<div class="kpi" id="k">Sent <b>10</b></div><svg id="c" width="100" height="40"></svg>',
  jsFunctions: 'function initReport(){document.getElementById("k").title="ok";}',
  jsExpressions: ['initReport()'],
};

const REPORT = {
  title: 'Q3 report',
  summary: 'Scripted.',
  kpis: [],
  sections: [{ heading: 'Messages', body: 'Sent 10.' }],
  sources: [],
};

/**
 * A stand-in language model for the end-to-end suite (the AI SDK's `LanguageModelV3`). It calls the tools it is told to, in order, one
 * per model turn, so the real agent loop, the real tools and the real database run; only the vendor is replaced. A turn after the
 * script ends answers "Done." and stops.
 */
export class ScriptedModel {
  readonly specificationVersion = 'v3';
  readonly provider = 'scripted';
  readonly modelId = 'scripted-1';
  readonly supportedUrls = {};

  calls = 0;
  prompts: SeenPrompt[] = [];
  private steps: Step[] = [];
  private cursor = 0;
  private failure: string | null = null;
  private gate: Promise<void> | null = null;

  reset(): void {
    this.calls = 0;
    this.prompts = [];
    this.steps = [];
    this.cursor = 0;
    this.failure = null;
    this.gate = null;
  }

  script(steps: Step[]): void {
    this.steps = steps;
    this.cursor = 0;
  }

  /** The next model turn fails the way a vendor does. */
  failNext(message: string): void {
    this.failure = message;
  }

  /** Holds the next model turns until the returned function is called: a run that is still going. */
  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((r) => (release = r));
    return () => {
      release();
      this.gate = null;
    };
  }

  doGenerate(): Promise<never> {
    return Promise.reject(new Error('the assistant streams; doGenerate is not used'));
  }

  async doStream(options: {
    prompt: Array<{ role: string; content: unknown }>;
    tools?: Array<{ name: string; description?: string }>;
  }) {
    this.calls++;
    if (this.gate) await this.gate;
    const system = options.prompt
      .filter((m) => m.role === 'system')
      .map((m) => String(m.content))
      .join('\n');
    const tools = options.tools ?? [];
    this.prompts.push({
      system,
      toolNames: tools.map((t) => t.name),
      toolDescriptions: Object.fromEntries(tools.map((t) => [t.name, t.description ?? ''])),
    });

    if (this.failure !== null) {
      const message = this.failure;
      this.failure = null;
      throw new Error(message);
    }

    const step = this.steps[this.cursor++];
    const parts: unknown[] = [{ type: 'stream-start', warnings: [] }];
    if (step === undefined) {
      parts.push(
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Done.' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', usage: USAGE, finishReason: { unified: 'stop', raw: 'stop' } },
      );
    } else {
      const [name, given] = typeof step === 'string' ? [step, undefined] : step;
      parts.push(
        {
          type: 'tool-call',
          toolCallId: randomUUID(),
          toolName: name,
          input: JSON.stringify(given ?? this.defaultInput(name, options.prompt)),
        },
        {
          type: 'finish',
          usage: USAGE,
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        },
      );
    }
    return {
      stream: new ReadableStream({
        start(controller) {
          for (const p of parts) controller.enqueue(p);
          controller.close();
        },
      }),
    };
  }

  private defaultInput(name: string, prompt: Array<{ role: string; content: unknown }>) {
    if (name === 'render_report') return REPORT;
    if (name === 'generateSandboxedUi') return SANDBOX_UI;
    if (name === 'read_document' || name === 'extract_document_figures') {
      // the document id the previous list_documents call returned
      const seen = JSON.stringify(prompt.filter((m) => m.role === 'tool'));
      const id = /documentId\\*":\\*"([0-9a-f-]{36})/.exec(seen)?.[1];
      return name === 'read_document'
        ? { documentId: id ?? randomUUID(), offset: 0 }
        : { documentId: id ?? randomUUID() };
    }
    if (name === 'list_documents') return {};
    return { window: '30d' };
  }
}
