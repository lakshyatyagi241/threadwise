import { describe, expect, it } from 'vitest';
import {
  createRecurringInvoiceSchema,
  updateRecurringInvoiceSchema,
  type RecurringInvoiceResponse,
  type TaxRateResponse,
} from '@crm/contracts';
import { emptyLine } from './builder';
import {
  CATCH_UP_MAX,
  buildCreateInput,
  buildUpdateInput,
  emptyRecurringForm,
  firstPeriodFrom,
  hasRecurringProblems,
  isEmptyPatch,
  matchesRecurring,
  missedPeriods,
  previewSchedule,
  previewStartIndex,
  pricingOfTemplate,
  rowActions,
  scheduleFacts,
  serverErrorsOn,
  shapeOf,
  statusFilterOf,
  suggestName,
  validateRecurring,
  warningsOf,
  type RecurringForm,
  type TemplateContext,
} from './recurring';

const TODAY = '2026-10-15';
const RATES: TaxRateResponse[] = [];
const CTX: TemplateContext = { rates: RATES, profile: undefined, today: TODAY, requireHsn: false };
const UUID = '4f9d4c1e-8a3b-4b7c-9f1d-2a6e5c7b8d90';

function form(over: Partial<RecurringForm> = {}): RecurringForm {
  const base = emptyRecurringForm({ currency: 'USD', dueDays: 14, terms: null }, TODAY);
  return {
    ...base,
    name: 'Retainer',
    startDate: '2026-11-01',
    draft: {
      ...base.draft,
      buyerName: 'Acme',
      lines: [{ ...emptyLine(), description: 'Work', qty: '2', price: '50' }],
    },
    ...over,
  };
}
const problems = (f: RecurringForm, kind: 'create' | 'edit' = 'create', templateChanged = false) =>
  validateRecurring(f, { kind, templateChanged, ctx: CTX, pricing: pricingOfTemplate(f, CTX) });

const saved = (over: Partial<RecurringInvoiceResponse> = {}): RecurringInvoiceResponse => ({
  id: UUID,
  name: 'Retainer',
  status: 'active',
  frequency: 'month',
  interval: 1,
  startDate: '2026-01-31',
  endDate: null,
  maxRuns: null,
  mode: 'draft',
  sendChannel: 'email',
  nextRunDate: '2026-11-30',
  lastRunAt: null,
  runCount: 9,
  failureCount: 0,
  upcoming: [],
  buyerName: 'Acme',
  currency: 'USD',
  amount: '100.00',
  contact: null,
  lineCount: 1,
  rowVersion: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('previewSchedule', () => {
  it('lists the next six dates and clamps month ends from the start day', () => {
    const s = shapeOf(form({ startDate: '2026-01-31' }))!;
    const p = previewSchedule(s)!;
    expect(p.runs.map((r) => r.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
    expect(p.runs.map((r) => r.clamped)).toEqual([false, true, false, true, false, true]);
    expect(p.clampsAtMonthEnd).toBe(true);
    expect(p.more).toBe(true);
    expect(p.endedBy).toBeNull();
    expect(p.totalRuns).toBeNull();
  });

  it('does not flag a start day that every month has', () => {
    const p = previewSchedule(shapeOf(form({ startDate: '2026-01-15' }))!)!;
    expect(p.clampsAtMonthEnd).toBe(false);
    expect(p.runs.every((r) => !r.clamped)).toBe(true);
  });

  it('stops at the run cap and says so', () => {
    const p = previewSchedule(shapeOf(form({ maxRuns: '3' }))!)!;
    expect(p.runs).toHaveLength(3);
    expect(p.more).toBe(false);
    expect(p.endedBy).toBe('maxRuns');
    expect(p.totalRuns).toBe(3);
  });

  it('stops at the end date and counts the invoices', () => {
    const p = previewSchedule(shapeOf(form({ startDate: '2026-01-01', endDate: '2026-04-15' }))!)!;
    expect(p.runs.map((r) => r.date)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
    ]);
    expect(p.endedBy).toBe('endDate');
    expect(p.totalRuns).toBe(4);
  });

  it('shows more when the cap is beyond the preview', () => {
    const p = previewSchedule(shapeOf(form({ maxRuns: '12' }))!)!;
    expect(p.runs).toHaveLength(6);
    expect(p.more).toBe(true);
    expect(p.endedBy).toBeNull();
    expect(p.totalRuns).toBe(12);
  });

  it('handles weekly and daily steps and yearly leap days', () => {
    expect(
      previewSchedule(
        shapeOf(form({ frequency: 'week', interval: '2', startDate: '2026-01-01' }))!,
        0,
        3,
      )!.runs.map((r) => r.date),
    ).toEqual(['2026-01-01', '2026-01-15', '2026-01-29']);
    expect(
      previewSchedule(
        shapeOf(form({ frequency: 'day', interval: '10', startDate: '2026-02-20' }))!,
        0,
        2,
      )!.runs.map((r) => r.date),
    ).toEqual(['2026-02-20', '2026-03-02']);
    const y = previewSchedule(
      shapeOf(form({ frequency: 'year', startDate: '2028-02-29' }))!,
      0,
      3,
    )!;
    expect(y.runs.map((r) => r.date)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28']);
    expect(y.runs.map((r) => r.clamped)).toEqual([false, true, true]);
  });

  it('is null while the schedule boxes are not valid', () => {
    expect(shapeOf(form({ interval: '0' }))).toBeNull();
    expect(shapeOf(form({ interval: 'x' }))).toBeNull();
    expect(shapeOf(form({ startDate: '' }))).toBeNull();
    expect(shapeOf(form({ maxRuns: '1001' }))).toBeNull();
    expect(previewSchedule(null)).toBeNull();
  });
});

describe('schedule position', () => {
  it('finds the first period from a date and counts missed ones like the server', () => {
    const s = shapeOf(form({ startDate: '2026-01-31' }))!;
    expect(firstPeriodFrom(s, '2026-10-15')).toEqual({ index: 9, date: '2026-10-31' });
    expect(missedPeriods(s, '2026-10-15')).toBe(9);
    expect(missedPeriods(shapeOf(form({ startDate: '2026-10-15' }))!, '2026-10-15')).toBe(0);
  });

  it('returns null when the schedule has no period left', () => {
    expect(
      firstPeriodFrom(shapeOf(form({ startDate: '2026-01-01', maxRuns: '2' }))!, '2026-10-15'),
    ).toBeNull();
  });

  it('starts an edit preview at the saved next run, or at today when the schedule changed', () => {
    const r = saved();
    const same = shapeOf(formFromSaved(r))!;
    expect(previewStartIndex(r, same, TODAY)).toBe(10); // 30 Nov 2026 is period 10 of a schedule that started on 31 Jan
    const weekly = shapeOf({ ...formFromSaved(r), frequency: 'week' })!;
    expect(previewStartIndex(r, weekly, TODAY)).toBe(firstPeriodFrom(weekly, TODAY)!.index);
  });
});

function formFromSaved(r: RecurringInvoiceResponse): RecurringForm {
  return form({
    frequency: r.frequency,
    interval: String(r.interval),
    startDate: r.startDate,
    endDate: r.endDate ?? '',
    maxRuns: r.maxRuns === null ? '' : String(r.maxRuns),
  });
}

describe('scheduleFacts', () => {
  it('names what happens to each invoice', () => {
    const shape = shapeOf(form({ maxRuns: '12' }))!;
    expect(scheduleFacts({ mode: 'draft', sendChannel: 'email', shape }).outcome).toBe('draft');
    expect(scheduleFacts({ mode: 'issue', sendChannel: 'email', shape }).outcome).toBe('issue');
    expect(scheduleFacts({ mode: 'issue_send', sendChannel: 'email', shape })).toMatchObject({
      outcome: 'issue_email',
      maxRuns: 12,
      interval: 1,
      frequency: 'month',
    });
    expect(scheduleFacts({ mode: 'issue_send', sendChannel: 'whatsapp', shape }).outcome).toBe(
      'issue_whatsapp',
    );
    expect(scheduleFacts({ mode: 'issue_send', sendChannel: 'link', shape }).outcome).toBe(
      'issue_link',
    );
  });
});

describe('validateRecurring', () => {
  it('accepts a complete schedule', () => {
    expect(hasRecurringProblems(problems(form()))).toBe(false);
  });

  it('checks the schedule boxes', () => {
    const p = problems(form({ name: ' ', interval: '0', maxRuns: '0', startDate: 'x' }));
    expect(p.name).toBe('nameRequired');
    expect(p.interval).toBe('intervalInvalid');
    expect(p.maxRuns).toBe('maxRunsInvalid');
    expect(p.startDate).toBe('startInvalid');
    expect(problems(form({ name: 'x'.repeat(121) })).name).toBe('nameTooLong');
  });

  it('refuses an end date before the start date', () => {
    expect(problems(form({ startDate: '2026-11-01', endDate: '2026-10-31' })).endDate).toBe(
      'endBeforeStart',
    );
    expect(
      problems(form({ startDate: '2026-11-01', endDate: '2026-11-01' })).endDate,
    ).toBeUndefined();
  });

  it('refuses a start date more than the catch-up window in the past (REC_START_TOO_OLD)', () => {
    expect(CATCH_UP_MAX).toBe(12);
    expect(problems(form({ startDate: '2025-01-15' })).startDate).toBe('startTooOld'); // 21 months back
    expect(problems(form({ startDate: '2025-11-15' })).startDate).toBeUndefined(); // 11 periods
    expect(problems(form({ startDate: '2025-10-15' })).startDate).toBeUndefined(); // 12 periods
    expect(problems(form({ startDate: '2025-09-15' })).startDate).toBe('startTooOld');
  });

  it('needs a copied invoice or a built template, not neither', () => {
    expect(problems(form({ source: 'invoice', fromInvoice: null })).template).toBe(
      'invoiceRequired',
    );
    const pick = { id: UUID, number: 'INV-1', buyerName: 'Acme', currency: 'USD', totalMinor: 100 };
    expect(hasRecurringProblems(problems(form({ source: 'invoice', fromInvoice: pick })))).toBe(
      false,
    );
  });

  it('needs a line, and a buyer when it issues by itself', () => {
    const empty = form({ draft: { ...form().draft, lines: [emptyLine()] } });
    expect(problems(empty).lines).toBe('noLines');
    const noBuyer = form({
      mode: 'issue',
      draft: { ...form().draft, buyerName: '', contactId: null },
    });
    expect(problems(noBuyer).buyerName).toBe('contactRequired');
    expect(
      problems(form({ mode: 'draft', draft: { ...form().draft, buyerName: '' } })).buyerName,
    ).toBeUndefined();
  });

  it('flags a bad line and a bad payment term', () => {
    const f = form({
      paymentTermsDays: '400',
      draft: {
        ...form().draft,
        lines: [{ ...emptyLine(), description: '', qty: '1', price: '5' }],
      },
    });
    const p = problems(f);
    expect(p['lines.0.description']).toBe('descriptionRequired');
    expect(p.paymentTermsDays).toBe('termsInvalid');
  });

  it('leaves the start date and the template alone when editing', () => {
    const f = form({ startDate: '2020-01-01', source: 'invoice', fromInvoice: null });
    expect(hasRecurringProblems(problems(f, 'edit', false))).toBe(false);
    expect(problems(f, 'edit', true).template).toBe('invoiceRequired');
  });

  it('warns about a missing buyer email only where the email is needed', () => {
    expect(warningsOf(form({ mode: 'issue_send', sendChannel: 'email' }))).toEqual([
      'noBuyerEmail',
    ]);
    expect(warningsOf(form({ mode: 'issue_send', sendChannel: 'link' }))).toEqual([]);
    expect(warningsOf(form({ mode: 'issue' }))).toEqual([]);
  });
});

describe('buildCreateInput', () => {
  it('sends the built template, in the shape the API accepts', () => {
    const body = buildCreateInput(
      form({ maxRuns: '12', endDate: '2027-12-31', mode: 'issue_send', paymentTermsDays: '30' }),
      CTX,
    );
    expect(body).toMatchObject({
      name: 'Retainer',
      frequency: 'month',
      interval: 1,
      startDate: '2026-11-01',
      endDate: '2027-12-31',
      maxRuns: 12,
      mode: 'issue_send',
      sendChannel: 'email',
    });
    expect(body.fromInvoiceId).toBeUndefined();
    expect(body.template).toMatchObject({
      paymentTermsDays: 30,
      currency: 'USD',
      buyerName: 'Acme',
    });
    expect(body.template).not.toHaveProperty('issueDate');
    expect(body.template).not.toHaveProperty('dueDate');
    expect(body.template!.lines).toEqual([{ description: 'Work', qty: '2', unitPrice: '50' }]);
    expect(createRecurringInvoiceSchema.safeParse(body).success).toBe(true);
  });

  it('sends fromInvoiceId and no template when copying an invoice', () => {
    const pick = { id: UUID, number: 'INV-1', buyerName: 'Acme', currency: 'USD', totalMinor: 100 };
    const body = buildCreateInput(form({ source: 'invoice', fromInvoice: pick }), CTX);
    expect(body.fromInvoiceId).toBe(UUID);
    expect(body.template).toBeUndefined();
    expect(body.endDate).toBeNull();
    expect(body.maxRuns).toBeNull();
    expect(createRecurringInvoiceSchema.safeParse(body).success).toBe(true);
  });

  it('is refused by the contract when the end date is before the start', () => {
    const body = buildCreateInput(form({ endDate: '2026-10-01' }), CTX);
    expect(createRecurringInvoiceSchema.safeParse(body).success).toBe(false);
  });
});

describe('buildUpdateInput', () => {
  const ctx = CTX;
  const same = (r: RecurringInvoiceResponse) => formFromSaved(r);

  it('sends nothing when nothing changed', () => {
    const r = saved({ name: 'Retainer' });
    expect(isEmptyPatch(buildUpdateInput(r, { ...same(r), name: 'Retainer' }, ctx, false))).toBe(
      true,
    );
  });

  it('sends only the changed schedule fields and never the start date', () => {
    const r = saved();
    const patch = buildUpdateInput(
      r,
      {
        ...same(r),
        name: 'New name',
        interval: '2',
        maxRuns: '24',
        mode: 'issue',
        startDate: '2030-01-01',
      },
      ctx,
      false,
    );
    expect(patch).toEqual({ name: 'New name', interval: 2, maxRuns: 24, mode: 'issue' });
    expect(
      updateRecurringInvoiceSchema.safeParse({ ...patch, rowVersion: r.rowVersion }).success,
    ).toBe(true);
  });

  it('clears the end date and the cap with null', () => {
    const r = saved({ endDate: '2027-01-01', maxRuns: 5 });
    const patch = buildUpdateInput(r, { ...same(r), endDate: '', maxRuns: '' }, ctx, false);
    expect(patch).toEqual({ endDate: null, maxRuns: null });
  });

  it('includes the template only when it is replaced', () => {
    const r = saved();
    const f = { ...same(r), name: 'Retainer' };
    expect(buildUpdateInput(r, f, ctx, false).template).toBeUndefined();
    const patch = buildUpdateInput(r, f, ctx, true);
    expect(patch.template?.lines).toHaveLength(1);
    expect(updateRecurringInvoiceSchema.safeParse({ ...patch, rowVersion: 3 }).success).toBe(true);
  });
});

describe('server errors', () => {
  it('maps template paths onto the draft lines that were sent', () => {
    const f = form({
      draft: {
        ...form().draft,
        lines: [emptyLine(), { ...emptyLine(), description: 'A', price: '1' }],
      },
    });
    const out = serverErrorsOn(
      { 'template.lines.0.qty': 'bad', startDate: 'too far', 'template.buyerEmail': 'bad email' },
      f.draft,
    );
    expect(out).toEqual({ 'lines.1.qty': 'bad', startDate: 'too far', buyerEmail: 'bad email' });
  });
});

describe('rows', () => {
  const can = { update: true, remove: true };
  it('offers pause on an active schedule and resume on a paused one', () => {
    expect(rowActions({ status: 'active', nextRunDate: '2026-11-01' }, can)).toEqual({
      pause: true,
      resume: false,
      runNow: true,
      edit: true,
      remove: true,
    });
    expect(rowActions({ status: 'paused', nextRunDate: '2026-11-01' }, can)).toMatchObject({
      pause: false,
      resume: true,
      runNow: true,
    });
  });
  it('offers an ended schedule only deletion', () => {
    expect(rowActions({ status: 'ended', nextRunDate: null }, can)).toEqual({
      pause: false,
      resume: false,
      runNow: false,
      edit: false,
      remove: true,
    });
  });
  it('follows the permissions', () => {
    expect(
      rowActions({ status: 'active', nextRunDate: '2026-11-01' }, { update: false, remove: false }),
    ).toEqual({ pause: false, resume: false, runNow: false, edit: false, remove: false });
  });
  it('maps tabs to the API status filter', () => {
    expect(statusFilterOf('all')).toBeUndefined();
    expect(statusFilterOf('paused')).toBe('paused');
  });
  it('filters the loaded rows by name, buyer or contact', () => {
    const r = {
      name: 'Monthly retainer',
      buyerName: 'Acme Ltd',
      contact: { id: UUID, name: 'Dana' },
    };
    expect(matchesRecurring(r, '')).toBe(true);
    expect(matchesRecurring(r, 'RETAIN')).toBe(true);
    expect(matchesRecurring(r, 'acme')).toBe(true);
    expect(matchesRecurring(r, 'dana')).toBe(true);
    expect(matchesRecurring(r, 'zzz')).toBe(false);
  });
  it('suggests a name from the buyer, else the number', () => {
    expect(suggestName({ buyerName: ' Acme ', number: 'INV-1' })).toBe('Acme');
    expect(suggestName({ buyerName: null, number: 'INV-1' })).toBe('INV-1');
  });
});
