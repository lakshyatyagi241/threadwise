import { reportSpecSchema, type ReportSpec } from '@crm/contracts';

/** The name of the frontend action the assistant calls to put a report on screen. The server's prompt names it too. */
export const RENDER_REPORT_ACTION = 'render_report';

export type RenderOutcome = { ok: true; spec: ReportSpec } | { ok: false; issues: string[] };

const MAX_ISSUES = 5;

/**
 * Checks what the model sent against the shared report schema. A malformed answer is an outcome, never an exception: the screen shows
 * an error card and the chat goes on (the model gets the issues back as the action's result and may try again).
 */
export function parseReportSpec(args: unknown): RenderOutcome {
  const parsed = reportSpecSchema.safeParse(args);
  if (parsed.success) return { ok: true, spec: parsed.data };
  const issues = parsed.error.issues
    .slice(0, MAX_ISSUES)
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
  return { ok: false, issues };
}

/**
 * The text the action hands back to the model. Plain JSON so the chat card can read it again, and so the model knows whether to
 * try again with a corrected report.
 */
export function actionResult(outcome: RenderOutcome): string {
  return outcome.ok
    ? JSON.stringify({ ok: true, title: outcome.spec.title })
    : JSON.stringify({
        ok: false,
        issues: outcome.issues,
        hint: 'The report was not drawn. Fix these fields and call render_report again.',
      });
}

export interface ActionResultView {
  ok: boolean;
  title?: string;
  issues: string[];
}

/** Reads `actionResult` back for the chat card. Anything else (an empty result, text from an error) reads as null. */
export function readActionResult(result: string | undefined): ActionResultView | null {
  if (!result) return null;
  try {
    const v: unknown = JSON.parse(result);
    if (typeof v !== 'object' || v === null || typeof (v as { ok?: unknown }).ok !== 'boolean')
      return null;
    const o = v as { ok: boolean; title?: unknown; issues?: unknown };
    return {
      ok: o.ok,
      ...(typeof o.title === 'string' ? { title: o.title } : {}),
      issues: Array.isArray(o.issues)
        ? o.issues.filter((i): i is string => typeof i === 'string')
        : [],
    };
  } catch {
    return null;
  }
}
