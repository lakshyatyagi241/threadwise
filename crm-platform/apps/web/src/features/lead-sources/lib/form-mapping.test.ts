import { describe, expect, it } from 'vitest';
import { leadFieldMappingSchema, updateLeadSourceSchema } from '@crm/contracts';
import { META_QUESTIONS, metaQuestion, source } from '../test-fixtures';
import {
  IGNORE,
  mappingFromRows,
  mappingUpdateFromRows,
  parseTarget,
  propertyTarget,
  rowProblems,
  rowsFromMapping,
  sameMapping,
  type QuestionRow,
} from './form-mapping';

const row = (key: string, target: string): QuestionRow => ({
  key,
  label: key,
  type: 'CUSTOM',
  target,
});
const targets = (rows: QuestionRow[]) => Object.fromEntries(rows.map((r) => [r.key, r.target]));

describe('targets', () => {
  it('reads a contact field, a property and nothing', () => {
    expect(parseTarget('email')).toEqual({ kind: 'field', field: 'email' });
    expect(parseTarget(propertyTarget('budget'))).toEqual({ kind: 'property', key: 'budget' });
    expect(parseTarget(IGNORE)).toEqual({ kind: 'none' });
    expect(parseTarget('property:')).toEqual({ kind: 'none' });
    expect(parseTarget('nonsense')).toEqual({ kind: 'none' });
  });
});

describe('rows from the stored mapping', () => {
  it('reads the mapping backwards: each question shows the target that points at its key', () => {
    const r = rowsFromMapping(META_QUESTIONS, {
      name: 'full_name',
      email: 'email',
      customFields: { budget: 'what_is_your_budget' },
    });
    expect(targets(r.rows)).toEqual({
      full_name: 'name',
      email: 'email',
      phone_number: IGNORE,
      what_is_your_budget: propertyTarget('budget'),
    });
    // something in the mapping points at a question, so nothing is guessed for the one left out
    expect(r.fromSuggestions).toBe(false);
    expect(r.multiUse).toEqual([]);
  });

  it('falls back to the suggestions of Meta when nothing in the mapping points at the form', () => {
    const r = rowsFromMapping(META_QUESTIONS, {});
    expect(r.fromSuggestions).toBe(true);
    expect(targets(r.rows)).toEqual({
      full_name: 'name',
      email: 'email',
      phone_number: 'phone',
      what_is_your_budget: IGNORE,
    });
    expect(rowsFromMapping(META_QUESTIONS, undefined).fromSuggestions).toBe(true);
  });

  it('does not suggest a target the mapping already fills from a path of its own', () => {
    const r = rowsFromMapping(META_QUESTIONS, { phone: 'lead.contact.mobile' });
    expect(r.fromSuggestions).toBe(true);
    expect(targets(r.rows).phone_number).toBe(IGNORE);
    expect(targets(r.rows).email).toBe('email');
  });

  it('gives a target to one suggestion only, the first question that asks for it', () => {
    const qs = [
      metaQuestion({
        key: 'work_email',
        label: 'Work email',
        type: 'EMAIL',
        suggestedTarget: 'email',
      }),
      metaQuestion({
        key: 'home_email',
        label: 'Home email',
        type: 'EMAIL',
        suggestedTarget: 'email',
      }),
    ];
    expect(targets(rowsFromMapping(qs, {}).rows)).toEqual({
      work_email: 'email',
      home_email: IGNORE,
    });
  });

  it('once the mapping points at the form, a question left out stays out (the rest of the mapping is theirs)', () => {
    const r = rowsFromMapping(META_QUESTIONS, { name: 'full_name' });
    expect(targets(r.rows).email).toBe(IGNORE);
    expect(targets(r.rows).phone_number).toBe(IGNORE);
  });

  it('reports a question the mapping used for several targets, and shows the first (fields before properties)', () => {
    const r = rowsFromMapping(META_QUESTIONS, {
      email: 'email',
      customFields: { contact_email: 'email' },
    });
    expect(r.multiUse).toEqual(['email']);
    expect(targets(r.rows).email).toBe('email');
  });

  it('trims paths and ignores blank ones', () => {
    const r = rowsFromMapping(META_QUESTIONS, { name: '  full_name ', email: '   ' });
    expect(targets(r.rows).full_name).toBe('name');
    expect(targets(r.rows).email).toBe(IGNORE);
  });

  it('a form with no questions has no rows', () => {
    expect(rowsFromMapping([], { name: 'x' }).rows).toEqual([]);
  });
});

describe('checking the rows', () => {
  it('refuses two questions going to the same contact field, marking the later one', () => {
    const p = rowProblems([row('a', 'email'), row('b', 'email'), row('c', 'phone')]);
    expect(p).toEqual({ b: { code: 'duplicateTarget', target: 'email' } });
  });

  it('refuses two questions going to the same contact property (a property holds one answer)', () => {
    const p = rowProblems([
      row('a', propertyTarget('budget')),
      row('b', propertyTarget('budget')),
      row('c', propertyTarget('city')),
    ]);
    expect(Object.keys(p)).toEqual(['b']);
  });

  it('lets any number of questions stay unmapped', () => {
    expect(rowProblems([row('a', IGNORE), row('b', IGNORE)])).toEqual({});
  });

  it('refuses a property key the contract would refuse', () => {
    expect(rowProblems([row('a', propertyTarget('Bad Key'))])).toEqual({
      a: { code: 'propertyKey', target: 'property:Bad Key' },
    });
  });
});

describe('rows to a mapping', () => {
  it('builds the mapping from the rows, and the contract accepts it', () => {
    const r = mappingFromRows(
      [
        row('full_name', 'name'),
        row('email', 'email'),
        row('phone_number', 'phone'),
        row('what_is_your_budget', propertyTarget('budget')),
        row('notes', IGNORE),
      ],
      undefined,
    );
    expect(r).toEqual({
      ok: true,
      mapping: {
        name: 'full_name',
        email: 'email',
        phone: 'phone_number',
        customFields: { budget: 'what_is_your_budget' },
      },
    });
    if (r.ok) expect(leadFieldMappingSchema.safeParse(r.mapping).success).toBe(true);
  });

  it('refuses rows that send two questions to one target and says which', () => {
    const r = mappingFromRows([row('a', 'email'), row('b', 'email')], undefined);
    expect(r).toEqual({
      ok: false,
      problems: { b: { code: 'duplicateTarget', target: 'email' } },
    });
  });

  it('keeps the attribution mapping exactly as it was', () => {
    const existing = {
      name: 'full_name',
      attribution: { campaign: 'meta_campaign_id', form: 'meta_form_name' },
    };
    const r = mappingFromRows([row('full_name', 'name'), row('email', 'email')], existing);
    expect(r.ok && r.mapping.attribution).toEqual(existing.attribution);
    // and not the same object, so the source in the cache is never edited in place
    expect(r.ok && r.mapping.attribution).not.toBe(existing.attribution);
  });

  it('keeps entries that point at a path which is not a question of this form, until a row claims their target', () => {
    const existing = {
      phone: 'lead.contact.mobile',
      email: 'meta_lead_id',
      customFields: { source_ref: 'meta_form_id', budget: 'old_budget_question' },
    };
    const kept = mappingFromRows([row('old_budget_question', IGNORE)], existing);
    // `budget` pointed at a question of the form, which the row now leaves unmapped, so it goes; the rest stays
    expect(kept).toEqual({
      ok: true,
      mapping: {
        phone: 'lead.contact.mobile',
        email: 'meta_lead_id',
        customFields: { source_ref: 'meta_form_id' },
      },
    });
    const claimed = mappingFromRows([row('phone_number', 'phone')], existing);
    expect(claimed.ok && claimed.mapping.phone).toBe('phone_number');
  });

  it('drops a mapping the person set back to automatic, and an empty result has no customFields key', () => {
    const r = mappingFromRows([row('email', IGNORE)], {
      email: 'email',
      customFields: { city: 'email' },
    });
    expect(r).toEqual({ ok: true, mapping: {} });
  });

  it('collapses a question the stored mapping used twice to the one target the row shows', () => {
    const existing = { email: 'email', customFields: { contact_email: 'email' } };
    const r = mappingFromRows([row('email', 'email')], existing);
    expect(r).toEqual({ ok: true, mapping: { email: 'email' } });
  });

  it('round-trips: rows from a mapping built from rows give the same rows', () => {
    const rows = rowsFromMapping(META_QUESTIONS, {}).rows;
    const built = mappingFromRows(rows, undefined);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const again = rowsFromMapping(META_QUESTIONS, built.mapping);
    expect(again.rows).toEqual(rows);
    expect(again.fromSuggestions).toBe(false);
    expect(mappingFromRows(again.rows, built.mapping)).toEqual(built);
  });

  it('round-trips a mapping with properties and keeps it identical', () => {
    const stored = {
      name: 'full_name',
      customFields: { budget: 'what_is_your_budget' },
      attribution: { ad: 'meta_ad_id' },
    };
    const rows = rowsFromMapping(META_QUESTIONS, stored).rows;
    const built = mappingFromRows(rows, stored);
    expect(built.ok && sameMapping(built.mapping, stored)).toBe(true);
  });
});

describe('the save request', () => {
  it('carries only the mapping and the row version the source was read at, and the contract accepts it', () => {
    const s = source({ rowVersion: 7, mapping: { attribution: { form: 'meta_form_name' } } });
    const r = mappingUpdateFromRows(
      [row('full_name', 'name'), row('what_is_your_budget', propertyTarget('budget'))],
      s,
    );
    expect(r).toEqual({
      ok: true,
      body: {
        rowVersion: 7,
        mapping: {
          name: 'full_name',
          customFields: { budget: 'what_is_your_budget' },
          attribution: { form: 'meta_form_name' },
        },
      },
    });
    if (r.ok) expect(updateLeadSourceSchema.safeParse(r.body).success).toBe(true);
    if (r.ok) expect(Object.keys(r.body).sort()).toEqual(['mapping', 'rowVersion']);
  });

  it('sends nothing when the rows have a problem', () => {
    const r = mappingUpdateFromRows([row('a', 'name'), row('b', 'name')], source());
    expect(r.ok).toBe(false);
  });
});

describe('comparing mappings', () => {
  it('ignores key order and blank entries', () => {
    expect(sameMapping({ name: 'a', email: 'b' }, { email: 'b', name: 'a' })).toBe(true);
    expect(sameMapping({ name: 'a', phone: ' ' }, { name: 'a' })).toBe(true);
    expect(sameMapping(undefined, {})).toBe(true);
    expect(sameMapping({ name: 'a' }, { name: 'b' })).toBe(false);
    expect(sameMapping({ customFields: { x: 'a' } }, { customFields: { y: 'a' } })).toBe(false);
  });
});
