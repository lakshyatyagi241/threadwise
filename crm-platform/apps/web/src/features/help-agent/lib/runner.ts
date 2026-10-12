import type { PageAgentCore, HistoricalEvent, PageAgentTool } from '@page-agent/core';
import type { FinishHelpAgentTaskInput } from '@crm/contracts';
import { StepBudget } from './budget';
import { makeModelFetch, type Failure } from './failure';
import {
  gatedClick,
  gatedInput,
  gatedSelect,
  type ConfirmRequest,
  type GateController,
  type GateDeps,
} from './gate';
import { clearHighlight, highlightElement } from './highlight';
import { applyAgentMarks } from './marks';
import { maskPageContent } from './mask';
import { systemInstructions, type AssistantMode } from './prompt';
import { assistantAllowedOn } from './url-guard';

/**
 * Runs one assistant task on the page-agent library, headless (docs/specs/help-agent-assistant.md sections 3, 4 and 6). Everything that
 * makes it safe is wired here: the model call goes to OUR proxy with the task id, the three acting tools are replaced by the gate, the
 * page text is masked before it leaves, our ignore marks are applied before every step, the step budget and the location guard stop the
 * task, and the person can stop it at any moment.
 *
 * The library is loaded on first use (`loadLibs`), so a page that never opens the assistant never pays for it.
 */

export type Outcome = FinishHelpAgentTaskInput['outcome'];

export interface Libs {
  PageAgentCore: new (config: Record<string, unknown>) => PageAgentCore;
  PageController: new (config?: Record<string, unknown>) => GateController & { dispose(): void };
  tool: <T>(t: PageAgentTool<T>) => PageAgentTool<T>;
  z: typeof import('zod/v4');
}

export async function loadLibs(): Promise<Libs> {
  const [core, controller, z] = await Promise.all([
    import('@page-agent/core'),
    import('@page-agent/page-controller'),
    import('zod/v4'),
  ]);
  return {
    PageAgentCore: core.PageAgentCore as unknown as Libs['PageAgentCore'],
    PageController: controller.PageController as unknown as Libs['PageController'],
    tool: core.tool as Libs['tool'],
    z,
  };
}

/** One row of the live step list. */
export interface StepView {
  n: number;
  /** What the model said it would do next (in the person's language). */
  goal: string;
  /** The tool it used. */
  action: string;
  /** What the tool answered, short. */
  result: string;
}

export type RunnerEvent =
  | { type: 'steps'; steps: StepView[] }
  | {
      type: 'activity';
      kind: 'click' | 'type' | 'select' | 'blocked' | 'declined' | 'shown';
      label: string;
    }
  | { type: 'thinking' };

export interface RunnerOptions {
  taskId: string;
  locale: string;
  maxSteps: number;
  mode: AssistantMode;
  /** Resolves true when the person allows this one action; the runner rejects it when the task stops. */
  confirm: (request: ConfirmRequest, signal: AbortSignal) => Promise<boolean>;
  /** Asks the person a question the model needs answered; rejects when the signal aborts. */
  ask: (question: string, signal: AbortSignal) => Promise<string>;
  onEvent: (event: RunnerEvent) => void;
  load?: () => Promise<Libs>;
  fetchImpl?: typeof fetch;
  /** Where the task runs; injected for tests. */
  location?: () => { origin: string; pathname: string };
  baseURL?: string;
  /** Seconds between steps; the library's own pause when left out. Tests set it to 0. */
  stepDelay?: number;
}

export interface RunResult {
  outcome: Outcome;
  /** The model's closing words, or a short reason in English for the log (the panel shows its own translated text). */
  message: string;
  steps: number;
  confirmed: number;
  denied: number;
  /** The last failed model call, with its request id, when that is what ended the task. */
  failure: Failure | null;
  /** Why the runner itself ended the task, when it did. */
  stoppedBy: 'person' | 'budget' | 'location' | null;
}

const trim = (s: string, n = 140): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function stepsOf(history: readonly HistoricalEvent[]): StepView[] {
  return history
    .filter((e): e is Extract<HistoricalEvent, { type: 'step' }> => e.type === 'step')
    .map((e) => ({
      n: e.stepIndex + 1,
      goal: trim(e.reflection.next_goal ?? ''),
      action: e.action.name,
      result: trim(e.action.output ?? ''),
    }));
}

export class TaskRunner {
  private agent: PageAgentCore | null = null;
  private readonly abort = new AbortController();
  private readonly counters = { confirmed: 0, denied: 0 };
  private failure: Failure | null = null;
  private stoppedBy: RunResult['stoppedBy'] = null;
  private readonly budget: StepBudget;

  constructor(private readonly opts: RunnerOptions) {
    this.budget = new StepBudget(opts.maxSteps);
  }

  /** Stops the task at once: the model call in flight is aborted and any waiting question or confirmation is released. */
  async stop(): Promise<void> {
    this.stoppedBy ??= 'person';
    this.abort.abort();
    await this.agent?.stop();
  }

  async run(task: string): Promise<RunResult> {
    const o = this.opts;
    const where =
      o.location ??
      (() => ({ origin: window.location.origin, pathname: window.location.pathname }));
    const libs = await (o.load ?? loadLibs)();
    if (this.abort.signal.aborted) return this.result('stopped', 'stopped before it started', 0);

    const controller = new libs.PageController({ enableMask: false });
    const gate: GateDeps = {
      controller,
      mode: () => o.mode,
      origin: where().origin,
      confirm: (request) => o.confirm(request, this.abort.signal),
      report: (line) => o.onEvent({ type: 'activity', kind: line.kind, label: line.label }),
      highlight: highlightElement,
      counters: this.counters,
    };
    const z = libs.z;
    const customTools: Record<string, PageAgentTool | null> = {
      click_element_by_index: libs.tool({
        description: 'Click element by index',
        inputSchema: z.object({ index: z.int().min(0) }),
        execute: async (input: { index: number }) => gatedClick(gate, input.index),
      }),
      input_text: libs.tool({
        description: 'Click and type text into an interactive input element',
        inputSchema: z.object({ index: z.int().min(0), text: z.string().max(2000) }),
        execute: async (input: { index: number; text: string }) =>
          gatedInput(gate, input.index, input.text),
      }),
      select_dropdown_option: libs.tool({
        description:
          'Select dropdown option for interactive element index by the text of the option you want to select',
        inputSchema: z.object({ index: z.int().min(0), text: z.string().max(300) }),
        execute: async (input: { index: number; text: string }) =>
          gatedSelect(gate, input.index, input.text),
      }),
    };

    const agent = new libs.PageAgentCore({
      pageController: controller,
      baseURL: o.baseURL ?? '/api/v2/help-agent',
      // The server chooses the model and the key; the library only needs a non-empty name to build its client.
      model: 'server',
      apiKey: '',
      language: 'en-US',
      maxSteps: o.maxSteps,
      maxRetries: 0,
      customFetch: makeModelFetch({
        taskId: o.taskId,
        fetchImpl: o.fetchImpl,
        onFailure: (f) => (this.failure = f),
      }),
      customTools,
      ...(o.stepDelay === undefined ? {} : { stepDelay: o.stepDelay }),
      instructions: { system: systemInstructions(o.locale, o.mode) },
      transformPageContent: maskPageContent,
      onBeforeStep: () => {
        applyAgentMarks();
        if (!this.budget.take()) {
          this.stoppedBy ??= 'budget';
          void agent.stop();
          return;
        }
        if (!assistantAllowedOn(where().pathname)) {
          this.stoppedBy ??= 'location';
          void agent.stop();
        }
        o.onEvent({ type: 'thinking' });
      },
      onAfterStep: (_agent: PageAgentCore, history: HistoricalEvent[]) => {
        clearHighlight();
        o.onEvent({ type: 'steps', steps: stepsOf(history) });
        // A click that landed on a screen the assistant may not use (a button that navigates by script) ends the task here.
        if (!assistantAllowedOn(where().pathname)) {
          this.stoppedBy ??= 'location';
          void agent.stop();
        }
      },
    });
    agent.onAskUser = (question, options) => o.ask(question, options?.signal ?? this.abort.signal);
    this.agent = agent;

    try {
      const res = await agent.execute(task);
      const taken = stepsOf(res.history);
      const steps = taken.length;
      // The library ends a task that used all its steps without calling done: that is the budget, not a failure of the model.
      if (
        !res.success &&
        !this.stoppedBy &&
        steps >= o.maxSteps &&
        taken.at(-1)?.action !== 'done'
      ) {
        this.stoppedBy = 'budget';
      }
      if (this.stoppedBy) return this.result('stopped', res.data, steps);
      return this.result(
        res.success ? 'completed' : this.failure ? 'error' : 'failed',
        res.data,
        steps,
      );
    } catch (err) {
      const steps = stepsOf(agent.history).length;
      if (this.stoppedBy) return this.result('stopped', String(err), steps);
      return this.result('error', err instanceof Error ? err.message : String(err), steps);
    } finally {
      clearHighlight();
      try {
        agent.dispose();
      } catch {
        // already disposed
      }
      this.agent = null;
    }
  }

  private result(outcome: Outcome, message: string, steps: number): RunResult {
    return {
      outcome,
      message,
      steps,
      confirmed: this.counters.confirmed,
      denied: this.counters.denied,
      failure: this.failure,
      stoppedBy: this.stoppedBy,
    };
  }
}
