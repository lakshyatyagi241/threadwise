import {
  REPORT_LIVE_METRICS,
  type ReportDocument,
  type ReportScope,
  type ReportWindow,
} from '@crm/contracts';

/**
 * What the assistant is told about the page it is on, built from live state only: the library, the chosen period, the reports so far,
 * and the live metric keys the contract lists for the scope. Nothing here is a fixed sample.
 */

/** The library as the assistant should see it: every document with its type, size and whether it could be read. */
export function documentsContext(docs: readonly ReportDocument[]) {
  return docs.map((d) => ({
    name: d.name,
    type: d.extension,
    sizeBytes: d.sizeBytes,
    status: d.status,
    ...(d.failureReason ? { problem: d.failureReason } : {}),
    ...(d.truncated ? { truncated: true } : {}),
    characters: d.charCount,
  }));
}

/** The live metric keys valid for the scope, with their labels and kind, exactly as the contract lists them. */
export const liveMetricsContext = (scope: ReportScope) =>
  REPORT_LIVE_METRICS[scope].map((m) => ({ key: m.key, label: m.label, kind: m.unit }));

export interface PageEnv {
  locale: string;
  timezone: string | null;
  currency: string | null;
}

/** Where and for whom the numbers are written: language, time zone and currency, when the app knows them. */
export const envContext = (env: PageEnv) => ({
  language: env.locale,
  ...(env.timezone ? { timezone: env.timezone } : {}),
  ...(env.currency ? { currency: env.currency } : {}),
});

export interface SuggestionState {
  scope: ReportScope;
  window: ReportWindow;
  locale: string;
  readyDocuments: number;
  failedDocuments: number;
  reports: number;
  /** The headings of the report on show, so follow-ups can build on it. */
  reportTitles: readonly string[];
}

/**
 * The brief CopilotKit's suggestion generator gets (its `instructions`). It describes the situation and what kind of next messages
 * help; the suggestions themselves are written by the model from the context it is also given, in the reader's language.
 */
export function suggestionInstructions(s: SuggestionState): string {
  const lines = [
    `Suggest the next things this person could ask on the Reports page (${s.scope} scope, numbers for the last ${s.window}). Write each title and message in the language with code "${s.locale}", short enough for a button, as a request the person would send.`,
  ];
  if (s.reports > 0) {
    lines.push(
      `A report has already been shown${s.reportTitles.length ? ` (${s.reportTitles.map((t) => `"${t}"`).join(', ')})` : ''}. Suggest follow-ups that build on it: another view of the same figures, a different kind of chart, a comparison with the previous period, a closer look at one part, or refreshing it.`,
    );
  } else if (s.readyDocuments > 0) {
    lines.push(
      `${s.readyDocuments} document${s.readyDocuments === 1 ? ' is' : 's are'} in the library (their names are in the context). Suggest requests that use those documents by name, alone or together with the live numbers.`,
    );
  } else {
    lines.push(
      'The library is empty. Suggest requests that need only the live numbers, and one that explains how documents could help.',
    );
  }
  if (s.failedDocuments > 0)
    lines.push(`${s.failedDocuments} document(s) could not be read; do not suggest using those.`);
  lines.push('Never put numbers in a suggestion unless they appear in the context.');
  return lines.join('\n');
}

/** Changes whenever suggestions should be written again: the library, the period, or the reports shown. */
export function suggestionKey(s: SuggestionState, docs: readonly ReportDocument[]): string {
  return JSON.stringify([
    s.scope,
    s.window,
    s.locale,
    s.reports,
    s.reportTitles,
    docs.map((d) => [d.id, d.status]),
  ]);
}
