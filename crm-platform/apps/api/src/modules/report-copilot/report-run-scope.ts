import { AsyncLocalStorage } from 'node:async_hooks';
import type { ReportScope, ReportWindow } from '@crm/contracts';
import type { RequestContext } from '../../common/context/request-context';
import type { RunPlan } from './report-ai.service';

/**
 * What one runtime request carries into the places the CopilotKit runtime calls back into (its agent factory and the runner): the
 * caller's request context, the key plan decided before the run, and where to report the tokens the run used. Opened by the controller
 * around the runtime call; nothing reads it outside that call.
 */
export interface RunScope {
  scope: ReportScope;
  ctx: RequestContext;
  /** Set for a `run` request, absent for `info`, `connect` and `stop`, which never call a model. */
  plan?: RunPlan;
  /** The period the screen has selected (`forwardedProps.window` of a run request); the default of the live-number tools. */
  window?: ReportWindow;
  /** Identifies the caller inside the process-wide in-flight table, so one tenant can never stop another's run. */
  tenantKey: string;
  /** Writes the run's token usage to the ledger; the stream is completed only after it settles. */
  onUsage: (usage: {
    promptTokens: number;
    completionTokens: number;
    model: string | null;
  }) => Promise<void>;
}

export const runScope = new AsyncLocalStorage<RunScope>();
