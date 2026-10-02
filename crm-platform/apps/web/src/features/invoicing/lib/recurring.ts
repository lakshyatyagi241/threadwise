import {
  RECURRING_CATCH_UP_MAX,
  occurrenceDate,
  upcomingRuns,
  type CreateInvoiceInput,
  type CreateRecurringInvoiceInput,
  type InvoiceProfile,
  type RecurringFrequency,
  type RecurringInvoiceResponse,
  type RecurringMode,
  type RecurringStatus,
  type TaxRateResponse,
  type UpdateRecurringInvoiceInput,
} from '@crm/contracts';
import {
  draftToBody,
  emptyDraft,
  pricingOf,
  validateDraft,
  usedIndexes,
  serverPath,
  type DraftPricing,
  type DraftProblems,
  type InvoiceDraft,
  type Problem,
} from './builder';
import { isDay } from './dates';

/**
 * Recurring invoices: the schedule editor's working copy and the pure rules around it. The date maths is the contracts' own
 * (`occurrenceDate`, `upcomingRuns`: the very functions the worker uses), so the preview shows what will really happen.
 * Money is never computed here: the template is priced by `pricingOf` (builder) for the preview and by the server for real.
 */

export const FREQUENCIES: readonly RecurringFrequency[] = ['day', 'week', 'month', 'year'];
export const MODES: readonly RecurringMode[] = ['draft', 'issue', 'issue_send'];
export const SEND_CHANNELS = ['link', 'email', 'whatsapp'] as const;
export type SendChannel = (typeof SEND_CHANNELS)[number];

/** The list's tabs: the API has no counts endpoint, so there are no badges. */
export const RECURRING_TABS = ['all', 'active', 'paused', 'ended'] as const;
export type RecurringTab = (typeof RECURRING_TABS)[number];
export const isRecurringTab = (v: string | null | undefined): v is RecurringTab =>
  (RECURRING_TABS as readonly string[]).includes(v ?? '');

/** The `status` filter of a tab (absent for "all"). */
export const statusFilterOf = (tab: RecurringTab): RecurringStatus | undefined =>
  tab === 'all' ? undefined : tab;

/** The API's error codes these screens answer in their own words (`invoicing.errors.codes.<code>`, chosen by `useErrorText`). */
export const RECURRING_ERROR_CODES = [
  'REC_ENDED',
  'REC_NOT_ACTIVE',
  'REC_START_TOO_OLD',
  'INV_RECURRING_INVALID',
] as const;

export const TEMPLATE_PAYMENT_TERMS = ['', '0', '7', '14', '15', '30', '45', '60'] as const;

// --- the form ---------------------------------------------------------------------------------------------------------------------

/** An invoice picked as the template to copy: just what the card shows. */
export interface PickedInvoice {
  id: string;
  number: string | null;
  buyerName: string | null;
  currency: string;
  totalMinor: number;
}

export type TemplateSource = 'invoice' | 'build';

export interface RecurringForm {
  name: string;
  frequency: RecurringFrequency;
  /** Typed. */
  interval: string;
  startDate: string;
  /** Empty: no end date. */
  endDate: string;
  /** Typed; empty: no cap. */
  maxRuns: string;
  mode: RecurringMode;
  sendChannel: SendChannel;
  source: TemplateSource;
  fromInvoice: PickedInvoice | null;
  /** The template when `source` is `build` (its dates are never used: every period brings its own). */
  draft: InvoiceDraft;
  /** Typed days; empty: the workspace's default terms apply to each generated invoice. */
  paymentTermsDays: string;
}

export function emptyRecurringForm(
  profile: Pick<InvoiceProfile, 'currency' | 'dueDays' | 'terms'> | undefined,
  today: string,
  fallbackCurrency = 'USD',
): RecurringForm {
  return {
    name: '',
    frequency: 'month',
    interval: '1',
    startDate: today,
    endDate: '',
    maxRuns: '',
    mode: 'draft',
    sendChannel: 'email',
    source: 'build',
    fromInvoice: null,
    draft: emptyDraft(profile, today, fallbackCurrency),
    paymentTermsDays: '',
  };
}

/** The schedule fields of a saved schedule as a form (the template is not in the response: it starts empty and is replaced as a whole). */
export function formFromRecurring(r: RecurringInvoiceResponse, base: RecurringForm): RecurringForm {
  return {
    ...base,
    name: r.name,
    frequency: r.frequency,
    interval: String(r.interval),
    startDate: r.startDate,
    endDate: r.endDate ?? '',
    maxRuns: r.maxRuns === null ? '' : String(r.maxRuns),
    mode: r.mode,
    sendChannel: (SEND_CHANNELS as readonly string[]).includes(r.sendChannel)
      ? (r.sendChannel as SendChannel)
      : 'email',
  };
}

/** The name a schedule gets when the person has not typed one: the buyer, else the invoice number. */
export const suggestName = (inv: Pick<PickedInvoice, 'buyerName' | 'number'>): string =>
  (inv.buyerName ?? '').trim() || (inv.number ?? '').trim();

/** An integer of 1..max typed in a box, or null. */
export function wholeOf(text: string, max: number): number | null {
  const s = text.trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= max ? n : null;
}
export const intervalOf = (text: string): number | null => wholeOf(text, 365);
export const maxRunsOf = (text: string): number | null => wholeOf(text, 1000);

/** The schedule, parsed (null while a box is not valid). */
export interface ScheduleShape {
  startDate: string;
  frequency: RecurringFrequency;
  interval: number;
  endDate: string | null;
  maxRuns: number | null;
}

export function shapeOf(
  f: Pick<RecurringForm, 'startDate' | 'frequency' | 'interval' | 'endDate' | 'maxRuns'>,
): ScheduleShape | null {
  const interval = intervalOf(f.interval);
  if (interval === null || !isDay(f.startDate)) return null;
  const maxRuns = f.maxRuns.trim() === '' ? null : maxRunsOf(f.maxRuns);
  if (f.maxRuns.trim() !== '' && maxRuns === null) return null;
  if (f.endDate !== '' && !isDay(f.endDate)) return null;
  return {
    startDate: f.startDate,
    frequency: f.frequency,
    interval,
    endDate: f.endDate === '' ? null : f.endDate,
    maxRuns,
  };
}

// --- the schedule as dates ------------------------------------------------------------------------------------------------------

/** The date of period `index`, or null past the end date or the run cap (the server's own rule). */
export function dateOfPeriod(s: ScheduleShape, index: number): string | null {
  if (s.maxRuns !== null && index >= s.maxRuns) return null;
  const d = occurrenceDate(s.startDate, s.frequency, s.interval, index);
  if (s.endDate && d > s.endDate) return null;
  return d;
}

/** The first period dated `date` or later (never before `floor`); null when none is left. */
export function firstPeriodFrom(
  s: ScheduleShape,
  date: string,
  floor = 0,
): { index: number; date: string } | null {
  for (let i = floor, guard = 0; guard < 20_000; i++, guard++) {
    const d = dateOfPeriod(s, i);
    if (d === null) return null;
    if (d >= date) return { index: i, date: d };
  }
  return null;
}

/** How many periods already lie in the past on `today`: the server catches up at most `RECURRING_CATCH_UP_MAX` of them. */
export function missedPeriods(s: ScheduleShape, today: string): number {
  let missed = 0;
  for (let i = 0; i < 1000; i++) {
    const d = dateOfPeriod(s, i);
    if (d === null || d >= today) break;
    missed++;
  }
  return missed;
}
export const CATCH_UP_MAX = RECURRING_CATCH_UP_MAX;

export interface PreviewRun {
  index: number;
  date: string;
  /** A monthly or yearly run that fell on the month's last day because the start day does not exist in that month. */
  clamped: boolean;
}

export interface SchedulePreview {
  runs: PreviewRun[];
  /** What stops the schedule after the shown runs (null: nothing, or more runs follow). */
  endedBy: 'maxRuns' | 'endDate' | null;
  /** True when more runs follow the ones listed. */
  more: boolean;
  /** The total number of invoices the schedule will make when it is bounded (end date or cap), else null. */
  totalRuns: number | null;
  /** The start day is past the 28th, so some months are shorter than it. */
  clampsAtMonthEnd: boolean;
}

export const PREVIEW_COUNT = 6;

/** The next `count` runs from period `fromIndex`, flagging month-end clamping and what ends the schedule. */
export function previewSchedule(
  s: ScheduleShape | null,
  fromIndex = 0,
  count = PREVIEW_COUNT,
): SchedulePreview | null {
  if (!s) return null;
  const runs = upcomingRuns({
    start: s.startDate,
    frequency: s.frequency,
    interval: s.interval,
    end: s.endDate,
    maxRuns: s.maxRuns,
    fromIndex,
    count,
  }).map((u) => ({
    index: u.index,
    date: u.date,
    clamped:
      (s.frequency === 'month' || s.frequency === 'year') &&
      Number(u.date.slice(8, 10)) !== Number(s.startDate.slice(8, 10)),
  }));
  const next = upcomingRuns({
    start: s.startDate,
    frequency: s.frequency,
    interval: s.interval,
    end: s.endDate,
    maxRuns: s.maxRuns,
    fromIndex: fromIndex + runs.length,
    count: 1,
  });
  const more = next.length > 0;
  let endedBy: SchedulePreview['endedBy'] = null;
  if (!more && runs.length > 0) {
    const nextIndex = fromIndex + runs.length;
    if (s.maxRuns !== null && nextIndex >= s.maxRuns) endedBy = 'maxRuns';
    else if (s.endDate) endedBy = 'endDate';
  }
  let totalRuns: number | null = null;
  if (s.maxRuns !== null || s.endDate) {
    let n = 0;
    while (n < 1000 && dateOfPeriod(s, n) !== null) n++;
    totalRuns = n >= 1000 ? null : n;
  }
  return {
    runs,
    endedBy,
    more,
    totalRuns,
    clampsAtMonthEnd:
      (s.frequency === 'month' || s.frequency === 'year') && Number(s.startDate.slice(8, 10)) > 28,
  };
}

/**
 * Where the preview starts when editing: the saved next run when the schedule is untouched, else the first period dated today or
 * later (a changed schedule continues from today, like the server).
 */
export function previewStartIndex(
  original: RecurringInvoiceResponse,
  s: ScheduleShape | null,
  today: string,
): number {
  if (!s) return 0;
  const untouched =
    s.frequency === original.frequency &&
    s.interval === original.interval &&
    s.endDate === original.endDate &&
    s.maxRuns === original.maxRuns;
  if (untouched && original.nextRunDate) {
    for (let i = 0; i < 2000; i++) {
      const d = dateOfPeriod(s, i);
      if (d === null || d > original.nextRunDate) break;
      if (d === original.nextRunDate) return i;
    }
  }
  return firstPeriodFrom(s, today)?.index ?? 0;
}

/** The facts the plain sentence is built from ("Every month from 31 Jan 2026, 12 invoices, issued and emailed"). */
export interface ScheduleFacts {
  frequency: RecurringFrequency;
  interval: number;
  start: string;
  maxRuns: number | null;
  end: string | null;
  /** `draft`, `issue`, `issue_email`, `issue_link`, `issue_whatsapp`. */
  outcome: 'draft' | 'issue' | 'issue_email' | 'issue_link' | 'issue_whatsapp';
}

export function scheduleFacts(
  f: Pick<RecurringForm, 'mode' | 'sendChannel'> & { shape: ScheduleShape },
): ScheduleFacts {
  const outcome: ScheduleFacts['outcome'] =
    f.mode === 'draft'
      ? 'draft'
      : f.mode === 'issue'
        ? 'issue'
        : (`issue_${f.sendChannel}` as ScheduleFacts['outcome']);
  return {
    frequency: f.shape.frequency,
    interval: f.shape.interval,
    start: f.shape.startDate,
    maxRuns: f.shape.maxRuns,
    end: f.shape.endDate,
    outcome,
  };
}

// --- the template -------------------------------------------------------------------------------------------------------------------

export interface TemplateContext {
  rates: readonly TaxRateResponse[];
  profile: Pick<InvoiceProfile, 'sellerCountry' | 'sellerState' | 'sellerTaxId'> | undefined;
  today: string;
  requireHsn: boolean;
}

/** The template draft with the dates the builder's checks want: a template has none (every period gets its own). */
const datedDraft = (d: InvoiceDraft, today: string): InvoiceDraft => ({
  ...d,
  issueDate: today,
  dueDate: '',
});

export const pricingOfTemplate = (
  f: RecurringForm,
  ctx: Pick<TemplateContext, 'rates' | 'profile' | 'today'>,
): DraftPricing => pricingOf(datedDraft(f.draft, ctx.today), ctx);

/** The template as the request carries it: the invoice body without the dates, with the payment terms in days. */
export function templateOf(
  f: RecurringForm,
  ctx: Pick<TemplateContext, 'rates' | 'profile'>,
): Omit<CreateInvoiceInput, 'issueDate' | 'dueDate'> {
  const {
    issueDate: _i,
    dueDate: _d,
    ...body
  } = draftToBody(f.draft, ctx.rates, ctx.profile?.sellerCountry);
  void _i;
  void _d;
  const days = f.paymentTermsDays.trim() === '' ? null : Number(f.paymentTermsDays);
  return { ...body, paymentTermsDays: days };
}

// --- problems ---------------------------------------------------------------------------------------------------------------------------

export type RecurringProblem =
  | 'nameRequired'
  | 'nameTooLong'
  | 'intervalInvalid'
  | 'startInvalid'
  | 'startTooOld'
  | 'endInvalid'
  | 'endBeforeStart'
  | 'maxRunsInvalid'
  | 'invoiceRequired'
  | 'termsInvalid';

export type RecurringProblems = Record<string, RecurringProblem | Problem>;
export const hasRecurringProblems = (p: RecurringProblems): boolean => Object.keys(p).length > 0;

export interface ValidateRecurringOptions {
  /** `create`: the start date is checked too; `edit`: it is fixed. */
  kind: 'create' | 'edit';
  /** Edit: the template stays as it is unless the person chose to replace it. */
  templateChanged: boolean;
  ctx: TemplateContext;
  pricing: DraftPricing;
}

export function validateRecurring(
  f: RecurringForm,
  o: ValidateRecurringOptions,
): RecurringProblems {
  const out: RecurringProblems = {};
  const name = f.name.trim();
  if (name === '') out.name = 'nameRequired';
  else if (name.length > 120) out.name = 'nameTooLong';
  if (intervalOf(f.interval) === null) out.interval = 'intervalInvalid';
  if (f.maxRuns.trim() !== '' && maxRunsOf(f.maxRuns) === null) out.maxRuns = 'maxRunsInvalid';
  if (o.kind === 'create' && !isDay(f.startDate)) out.startDate = 'startInvalid';
  if (f.endDate !== '') {
    if (!isDay(f.endDate)) out.endDate = 'endInvalid';
    else if (isDay(f.startDate) && f.endDate < f.startDate) out.endDate = 'endBeforeStart';
  }
  const shape = shapeOf(f);
  if (
    o.kind === 'create' &&
    shape &&
    !out.startDate &&
    missedPeriods(shape, o.ctx.today) > CATCH_UP_MAX
  )
    out.startDate = 'startTooOld';

  const needsTemplate = o.kind === 'create' || o.templateChanged;
  if (needsTemplate) {
    if (f.source === 'invoice') {
      if (!f.fromInvoice) out.template = 'invoiceRequired';
    } else {
      if (
        f.paymentTermsDays.trim() !== '' &&
        (!/^\d{1,3}$/.test(f.paymentTermsDays.trim()) || Number(f.paymentTermsDays) > 365)
      ) {
        out.paymentTermsDays = 'termsInvalid';
      }
      // Generated invoices are issued without a person looking at them, so an issuing schedule needs what an issue needs.
      const checks = validateDraft(datedDraft(f.draft, o.ctx.today), o.pricing, {
        mode: f.mode === 'draft' ? 'draft' : 'issue',
        requireHsn: o.ctx.requireHsn,
        sellerCountry: o.ctx.profile?.sellerCountry,
      });
      Object.assign(out, withoutDates(checks));
      if (usedIndexes(f.draft.lines).length === 0) out.lines = 'noLines';
    }
  }
  return out;
}

const withoutDates = (p: DraftProblems): DraftProblems => {
  const { issueDate: _i, dueDate: _d, ...rest } = p;
  void _i;
  void _d;
  return rest;
};

/** The server's field errors on the form's own paths: `template.lines.1.qty` is the draft's line, `startDate` stays. */
export function serverErrorsOn(
  fields: Record<string, string>,
  draft: InvoiceDraft,
): Record<string, string> {
  const used = usedIndexes(draft.lines);
  const out: Record<string, string> = {};
  for (const [path, message] of Object.entries(fields)) {
    const own = path.startsWith('template.')
      ? serverPath(path.slice('template.'.length), used)
      : path;
    if (!(own in out)) out[own] = message;
  }
  return out;
}

/** Things worth a note that do not stop a save. */
export type RecurringWarning = 'noBuyerEmail';
export function warningsOf(f: RecurringForm): RecurringWarning[] {
  const out: RecurringWarning[] = [];
  if (
    f.mode === 'issue_send' &&
    f.sendChannel === 'email' &&
    f.source === 'build' &&
    f.draft.buyerEmail.trim() === ''
  )
    out.push('noBuyerEmail');
  return out;
}

// --- the requests ---------------------------------------------------------------------------------------------------------------------

/** The body of `POST /recurring-invoices`: the copied invoice (`fromInvoiceId`) or the built template, never both. */
export function buildCreateInput(
  f: RecurringForm,
  ctx: Pick<TemplateContext, 'rates' | 'profile'>,
): CreateRecurringInvoiceInput {
  const base = {
    name: f.name.trim(),
    frequency: f.frequency,
    interval: intervalOf(f.interval) ?? 1,
    startDate: f.startDate,
    endDate: f.endDate === '' ? null : f.endDate,
    maxRuns: f.maxRuns.trim() === '' ? null : maxRunsOf(f.maxRuns),
    mode: f.mode,
    sendChannel: f.sendChannel,
  };
  return f.source === 'invoice' && f.fromInvoice
    ? { ...base, fromInvoiceId: f.fromInvoice.id }
    : { ...base, template: templateOf(f, ctx) };
}

/**
 * The body of `PATCH /recurring-invoices/:id` (without `rowVersion`): only the schedule fields that differ from the saved one, and
 * the template only when the person replaced it (it then rules FUTURE invoices; the ones already made stay as they are).
 * The start date cannot be edited.
 */
export function buildUpdateInput(
  original: RecurringInvoiceResponse,
  f: RecurringForm,
  ctx: Pick<TemplateContext, 'rates' | 'profile'>,
  replaceTemplate: boolean,
): Omit<UpdateRecurringInvoiceInput, 'rowVersion'> {
  const patch: Omit<UpdateRecurringInvoiceInput, 'rowVersion'> = {};
  const name = f.name.trim();
  if (name !== original.name) patch.name = name;
  if (f.frequency !== original.frequency) patch.frequency = f.frequency;
  const interval = intervalOf(f.interval);
  if (interval !== null && interval !== original.interval) patch.interval = interval;
  const end = f.endDate === '' ? null : f.endDate;
  if (end !== original.endDate) patch.endDate = end;
  const max = f.maxRuns.trim() === '' ? null : maxRunsOf(f.maxRuns);
  if (max !== original.maxRuns) patch.maxRuns = max;
  if (f.mode !== original.mode) patch.mode = f.mode;
  if (f.sendChannel !== original.sendChannel) patch.sendChannel = f.sendChannel;
  if (replaceTemplate) patch.template = templateOf(f, ctx);
  return patch;
}

export const isEmptyPatch = (p: object): boolean => Object.keys(p).length === 0;

// --- rows ---------------------------------------------------------------------------------------------------------------------------------

export const isEnded = (r: Pick<RecurringInvoiceResponse, 'status'>): boolean =>
  r.status === 'ended';

export interface RecurringRowActions {
  pause: boolean;
  resume: boolean;
  runNow: boolean;
  edit: boolean;
  remove: boolean;
}

/** What a row offers (the server answers 409 REC_ENDED for the rest). */
export function rowActions(
  r: Pick<RecurringInvoiceResponse, 'status' | 'nextRunDate'>,
  can: { update: boolean; remove: boolean },
): RecurringRowActions {
  const ended = r.status === 'ended';
  return {
    pause: can.update && r.status === 'active',
    resume: can.update && r.status === 'paused',
    runNow: can.update && !ended && r.nextRunDate !== null,
    edit: can.update && !ended,
    remove: can.remove,
  };
}

/** Client-side filter of the LOADED rows by name or buyer. */
export function matchesRecurring(
  r: Pick<RecurringInvoiceResponse, 'name' | 'buyerName' | 'contact'>,
  text: string,
): boolean {
  const q = text.trim().toLowerCase();
  if (q === '') return true;
  return [r.name, r.buyerName ?? '', r.contact?.name ?? ''].some((s) =>
    s.toLowerCase().includes(q),
  );
}

/** "run 3 of 12" / "run 3": the progress shown in the table. */
export const runsLabel = (
  r: Pick<RecurringInvoiceResponse, 'runCount' | 'maxRuns'>,
): { done: number; of: number | null } => ({
  done: r.runCount,
  of: r.maxRuns,
});
