/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The add-on under the Apps Script harness with a fake CRM behind it, plus the steps a member takes (paste the URL, Submit), so the
 * specs read as what a person does in the sheet.
 */
import { AppsScriptHarness, type HarnessOptions, type RunResult } from './apps-script-harness';
import { FAKE_HOOK_URL, FAKE_KEY, FAKE_ORIGIN, FakeCrm } from './apps-script-fake-crm';

export { FAKE_HOOK_URL, FAKE_KEY, FAKE_ORIGIN, FakeCrm };

export const LEADS_HEADERS = ['Name', 'Email', 'Phone', 'Status'];

export interface Kit {
  h: AppsScriptHarness;
  crm: FakeCrm;
}

export function newKit(options: HarnessOptions = {}): Kit {
  const crm = new FakeCrm();
  const h = new AppsScriptHarness({ fetch: crm.handler, ...options });
  return { h, crm };
}

/** The result of a call from a dialog, as the page receives it: asserts the call itself did not fail. */
export function fromPage<T = Record<string, any>>(
  h: AppsScriptHarness,
  fn: string,
  ...args: unknown[]
): T {
  const r: RunResult = h.callFromClient(fn, ...args);
  if (!r.ok) throw new Error(`${fn} failed: ${r.error}`);
  return r.value as T;
}

export interface SetupInput {
  url?: string;
  sheet?: string;
  column?: string;
  onEvent?: boolean;
  onSchedule?: boolean;
}

/** Initial Setup, Submit: what the Settings window sends. */
export function submit(h: AppsScriptHarness, input: SetupInput = {}) {
  return fromPage(h, 'submitSetup', {
    url: FAKE_HOOK_URL,
    sheet: 'Leads',
    column: '',
    onEvent: false,
    onSchedule: false,
    ...input,
  });
}

/** A "Leads" sheet with a header row and `rows` data rows (names, emails and phones are unique per row). */
export function leadsSheet(h: AppsScriptHarness, rows: number, name = 'Leads'): void {
  const data: unknown[][] = [LEADS_HEADERS.slice(0, 3)];
  for (let i = 0; i < rows; i++) data.push([`Person ${i + 1}`, `p${i + 1}@example.com`, '']);
  h.loadSheet(name, data, { activate: true });
}
