import { describe, expect, it } from 'vitest';
import { assignmentConditionsSchema } from '@crm/contracts';
import {
  candidateOrder,
  matchesAssignment,
  type AssignmentFacts,
} from '../../../src/modules/crm/contact-assignment/assignment-matcher';
import { originOf } from '../../../src/modules/crm/contact-assignment/contact-assignment.consumer';

const cond = (over: Record<string, unknown> = {}) => assignmentConditionsSchema.parse(over);
const facts = (over: Partial<AssignmentFacts> = {}): AssignmentFacts => ({
  source: 'Website',
  countryCode: 'IN',
  phoneDigits: '919812345678',
  lifecycleStage: 'new',
  tagIds: ['t1'],
  origin: 'form',
  properties: { plan: 'Pro', Region: 'North' },
  pipelineId: 'p1',
  value: 500,
  ...over,
});

describe('matchesAssignment', () => {
  it('no condition is a catch-all', () => {
    expect(matchesAssignment(cond(), facts())).toBe(true);
  });

  it('text conditions ignore case and surrounding spaces; any of the list', () => {
    expect(matchesAssignment(cond({ sources: [' website ', 'ads'] }), facts())).toBe(true);
    expect(matchesAssignment(cond({ sources: ['ads'] }), facts())).toBe(false);
    expect(matchesAssignment(cond({ sources: ['ads'] }), facts({ source: null }))).toBe(false);
    expect(matchesAssignment(cond({ countryCodes: ['in'] }), facts())).toBe(true);
    expect(matchesAssignment(cond({ lifecycleStages: ['customer'] }), facts())).toBe(false);
  });

  it('a country code is the same code whether it is written +91, 91 or 0091', () => {
    for (const written of ['+91', '91', '0091', ' +91 ']) {
      expect(
        matchesAssignment(cond({ countryCodes: [written] }), facts({ countryCode: '91' })),
      ).toBe(true);
      expect(
        matchesAssignment(cond({ countryCodes: ['91'] }), facts({ countryCode: written })),
      ).toBe(true);
    }
    expect(matchesAssignment(cond({ countryCodes: ['+44'] }), facts({ countryCode: '91' }))).toBe(
      false,
    );
    expect(matchesAssignment(cond({ countryCodes: ['+91'] }), facts({ countryCode: null }))).toBe(
      false,
    );
  });

  it('a phone prefix is the country from the number: digits, so +91 and 0091 styles both work', () => {
    expect(matchesAssignment(cond({ phonePrefixes: ['91'] }), facts())).toBe(true);
    expect(matchesAssignment(cond({ phonePrefixes: ['44', '1'] }), facts())).toBe(false);
    expect(matchesAssignment(cond({ phonePrefixes: ['91'] }), facts({ phoneDigits: null }))).toBe(
      false,
    );
  });

  it('tags need any one, properties need all, origins need the listed way in', () => {
    const t = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    expect(matchesAssignment(cond({ tagIds: [t] }), facts())).toBe(false);
    expect(matchesAssignment(cond({ tagIds: [t] }), facts({ tagIds: [t] }))).toBe(true);
    expect(
      matchesAssignment(
        cond({
          properties: [
            { key: 'plan', equals: 'pro' },
            { key: 'Region', equals: 'North' },
          ],
        }),
        facts(),
      ),
    ).toBe(true);
    expect(
      matchesAssignment(
        cond({
          properties: [
            { key: 'plan', equals: 'pro' },
            { key: 'Region', equals: 'South' },
          ],
        }),
        facts(),
      ),
    ).toBe(false);
    expect(matchesAssignment(cond({ properties: [{ key: 'missing', equals: '' }] }), facts())).toBe(
      true,
    ); // absent equals empty
    expect(matchesAssignment(cond({ origins: ['import'] }), facts())).toBe(false);
    expect(matchesAssignment(cond({ origins: ['import', 'form'] }), facts())).toBe(true);
  });

  it('deal conditions: pipeline and value bounds (both inclusive; a missing value fails a bound)', () => {
    const p1 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    expect(matchesAssignment(cond({ pipelineIds: [p1] }), facts({ pipelineId: p1 }))).toBe(true);
    expect(matchesAssignment(cond({ pipelineIds: [p1] }), facts({ pipelineId: null }))).toBe(false);
    expect(matchesAssignment(cond({ valueMin: 500, valueMax: 500 }), facts())).toBe(true);
    expect(matchesAssignment(cond({ valueMin: 501 }), facts())).toBe(false);
    expect(matchesAssignment(cond({ valueMax: 499 }), facts())).toBe(false);
    expect(matchesAssignment(cond({ valueMin: 1 }), facts({ value: null }))).toBe(false);
  });

  it('everything set must hold together', () => {
    expect(
      matchesAssignment(
        cond({ sources: ['website'], countryCodes: ['IN'], origins: ['form'] }),
        facts(),
      ),
    ).toBe(true);
    expect(matchesAssignment(cond({ sources: ['website'], countryCodes: ['US'] }), facts())).toBe(
      false,
    );
  });
});

describe('candidateOrder and originOf', () => {
  it("lists the named people first, then the teams' members, once each", () => {
    expect(candidateOrder([5, 2], [2, 9, 5, 1])).toEqual([5, 2, 9, 1]);
  });

  it('maps how a contact arrived', () => {
    expect(originOf('import')).toBe('import');
    expect(originOf('inbound')).toBe('inbound');
    expect(originOf('whatsapp')).toBe('inbound');
    expect(originOf(undefined)).toBe('manual');
    expect(originOf('something else')).toBe('manual');
  });
});
