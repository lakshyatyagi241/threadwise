import { Logger } from '@nestjs/common';
import { AgentRunner, createRunEventFinalizer } from '@copilotkit/runtime/v2';
import type {
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  AgentRunnerStopRequest,
} from '@copilotkit/runtime/v2';
import { EMPTY, Observable } from 'rxjs';
import { publicRunError, sumUsage } from './report-rules';
import { runScope } from './report-run-scope';

/** The runtime's event type, read off its own agent API (it is not a direct dependency, and it ships its own copy of rxjs). */
type AgentSubscriber = NonNullable<Parameters<AgentRunnerRunRequest['agent']['runAgent']>[1]>;
type RunEvent = Parameters<NonNullable<AgentSubscriber['onEvent']>>[0]['event'];
/** The runtime's Observable type: structurally the same class as ours, but from another copy of rxjs, so it needs a cast at the boundary. */
type RuntimeStream = ReturnType<AgentRunner['run']>;

interface InFlight {
  runId: string;
  stop(): void;
}

/**
 * Runs an agent and streams its events, keeping nothing afterwards.
 *
 * The runtime's own in-memory runner stores every thread's events and messages in ONE process-wide table keyed only by the thread id the
 * browser chose. Behind a multi-tenant API that is a place where one workspace's chat (which holds its documents' text and numbers)
 * could be replayed to another that guesses or learns the id, and it is memory the process never gives back for reports nobody reopens.
 * This runner has no history: a run lives for the length of its stream, the chat is the browser's, and `connect` (reconnecting to a
 * thread) answers empty, exactly as the in-memory runner does for a thread it has not seen.
 *
 * The in-flight table only exists so the Stop button works. It is keyed by caller as well as by thread id.
 *
 * It also does two jobs for the run on the way past: it reads the token usage off the closing event so the caller can write the AI token
 * ledger, and it replaces a vendor's failure text (which can quote part of a key) with a plain sentence, logging the original.
 */
export class StatelessAgentRunner extends AgentRunner {
  private readonly logger = new Logger(StatelessAgentRunner.name);
  private readonly inflight = new Map<string, InFlight>();

  private key(threadId: string): string {
    return `${runScope.getStore()?.tenantKey ?? 'none'}:${threadId}`;
  }

  run(request: AgentRunnerRunRequest): RuntimeStream {
    const scope = runScope.getStore();
    const key = this.key(request.threadId);

    const stream = new Observable<RunEvent>((subscriber) => {
      const finalizer = createRunEventFinalizer();
      let stopRequested = false;
      let finished = false;
      // The ledger write started when the run's closing event passed; the stream is completed only after it, so a caller that
      // has read the whole stream can rely on the row being there.
      let ledger: Promise<void> = Promise.resolve();

      // A second run on a thread replaces the first (a fast follow-up turn) instead of failing with "already running".
      this.inflight.get(key)?.stop();
      const handle: InFlight = {
        runId: request.input.runId,
        stop: () => {
          stopRequested = true;
          request.agent.abortRun();
        },
      };
      this.inflight.set(key, handle);

      const emit = (event: RunEvent) => {
        finalizer.observe(event);
        subscriber.next(event);
      };

      const finish = (error?: unknown) => {
        if (finished) return;
        finished = true;
        if (this.inflight.get(key) === handle) this.inflight.delete(key);
        if (error !== undefined) {
          this.logger.warn({ err: String(error) }, 'a report assistant run failed');
        }
        for (const closer of finalizer.finalize({
          stopRequested,
          protocolVersion: request.input.protocolVersion,
          ...(error !== undefined ? { interruptionMessage: publicRunError(error) } : {}),
        })) {
          subscriber.next(closer);
        }
        subscriber.complete();
      };

      void request.agent
        .runAgent(request.input, {
          onEvent: ({ event }) => {
            const e = event as RunEvent & { type: string; message?: unknown; usage?: unknown };
            if (e.type === 'RUN_FINISHED') {
              const usage = sumUsage(e.usage);
              if (usage && scope) ledger = scope.onUsage(usage);
            }
            if (e.type === 'RUN_ERROR') {
              this.logger.warn(
                { err: String(e.message) },
                'the report assistant reported a run error',
              );
              emit({ ...e, message: publicRunError(e.message) } as RunEvent);
              return;
            }
            emit(event);
          },
        })
        .then(() => ledger)
        .then(() => finish())
        .catch((err: unknown) => finish(err));

      // The stream's reader went away (the browser closed the tab): stop paying for an answer nobody will read.
      return () => {
        if (!finished) {
          finished = true;
          if (this.inflight.get(key) === handle) this.inflight.delete(key);
          request.agent.abortRun();
        }
      };
    });
    return stream as unknown as RuntimeStream;
  }

  connect(_request: AgentRunnerConnectRequest): RuntimeStream {
    return EMPTY as unknown as RuntimeStream;
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return Promise.resolve(this.inflight.has(this.key(request.threadId)));
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const handle = this.inflight.get(this.key(request.threadId));
    // A stop that names a run never stops a newer run on the same thread.
    if (!handle || (request.runId !== undefined && request.runId !== handle.runId)) {
      return Promise.resolve(false);
    }
    handle.stop();
    return Promise.resolve(true);
  }
}
