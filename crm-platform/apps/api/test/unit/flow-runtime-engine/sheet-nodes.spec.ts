import { describe, expect, it, vi } from 'vitest';
import {
  runSheetCheck,
  runSheetContact,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/integrations/google-nodes';

function ctx(d: Record<string, unknown>, run: Record<string, unknown> = {}) {
  const notes: string[] = [];
  return {
    notes,
    c: {
      run: { orgId: 7, contactId: 40, vars: { phone: '9198' } as Record<string, unknown>, ...run },
      node: { id: 'n', type: 'x', props: { data: d } },
      note: (t: string) => notes.push(t),
      now: () => new Date('2026-10-08T00:00:00Z'),
    } as never,
  };
}
const google = (rows: Array<Record<string, string>> | Error) => ({
  readSheetRows: vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  }),
});
const base = { sheetId: 'S1', matchColumn: 'Phone', matchValue: '{{phone}}' };

describe('Check Google Sheet cell', () => {
  it('yes when the cell meets the operator, no when it does not', async () => {
    const g = google([{ Phone: '9198', Status: 'Paid' }]);
    const yes = ctx({ ...base, checkColumn: 'Status', operator: 'equals', value: 'paid' });
    expect(await runSheetCheck(yes.c, g as never)).toMatchObject({ port: 1 });
    expect(g.readSheetRows).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ matchColumn: 'Phone', matchValue: '9198', limit: 1 }),
    );
    const no = ctx({ ...base, checkColumn: 'Status', operator: 'equals', value: 'due' });
    expect(await runSheetCheck(no.c, g as never)).toMatchObject({ port: 2 });
    const empty = ctx({ ...base, checkColumn: 'Status', operator: 'is_not_set' });
    expect(await runSheetCheck(empty.c, google([{ Phone: '9198' }]) as never)).toMatchObject({
      port: 1,
    });
  });

  it('no when there is no row, no sheet, no column, or Google fails', async () => {
    for (const [d, rows] of [
      [{ ...base, checkColumn: 'Status', operator: 'equals', value: 'x' }, []],
      [{ matchColumn: 'Phone', checkColumn: 'Status' }, [{ Status: 'x' }]],
      [{ ...base, operator: 'equals' }, [{ Status: 'x' }]],
      [{ ...base, checkColumn: 'Status' }, new Error('No Google account connected')],
    ] as const) {
      const x = ctx({ ...d });
      expect(await runSheetCheck(x.c, google(rows as never) as never)).toMatchObject({ port: 2 });
    }
  });
});

describe('Save contact from Google Sheet', () => {
  it('copies mapped cells into the contact and the run variables', async () => {
    const save = vi.fn(async (field: string) => field !== 'bad');
    const x = ctx({
      ...base,
      map: [
        { column: 'Name', field: 'name' },
        { column: 'City', field: 'city' },
        { column: 'Nope', field: 'title' },
        { column: 'City', field: 'bad' },
      ],
    });
    const out = await runSheetContact(
      x.c,
      google([{ Phone: '9198', Name: 'Asha', City: 'Pune' }]) as never,
      save,
    );
    expect(out).toMatchObject({ kind: 'advance', port: 1 });
    expect(save.mock.calls.map((c) => c.join('='))).toEqual(['name=Asha', 'city=Pune', 'bad=Pune']);
    expect((x.c as never as { run: { vars: Record<string, unknown> } }).run.vars).toMatchObject({
      name: 'Asha',
      city: 'Pune',
    });
    expect(x.notes.join(' ')).toMatch(/2 contact fields saved/);
  });

  it('skips with a reason: no mapping, no contact, no row', async () => {
    const save = vi.fn();
    const a = ctx(base);
    await runSheetContact(a.c, google([]) as never, save);
    expect(a.notes[0]).toMatch(/no columns/);
    const b = ctx({ ...base, map: [{ column: 'A', field: 'name' }] }, { contactId: null });
    await runSheetContact(b.c, google([{ A: 'x' }]) as never, save);
    expect(b.notes[0]).toMatch(/no contact/);
    const c = ctx({ ...base, map: [{ column: 'A', field: 'name' }] });
    expect(await runSheetContact(c.c, google([]) as never, save)).toMatchObject({ port: 1 });
    expect(save).not.toHaveBeenCalled();
  });
});
