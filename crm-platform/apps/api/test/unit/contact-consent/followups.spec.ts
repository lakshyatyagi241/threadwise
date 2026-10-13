import { describe, expect, it } from 'vitest';
import {
  CONSENT_EXPORT_SYNC_MAX,
  contactImportOptionsSchema,
  detectImportColumns,
  parseImportConsent,
} from '@crm/contracts';
import { consentLineBody } from '../../../src/modules/contact-consent/consent-keyword.listener';
import {
  CONSENT_CSV_HEADER,
  proofCsvLine,
} from '../../../src/modules/contact-consent/consent.rules';
import { EXPORT_MAX } from '../../../src/modules/contact-consent/consent.service';
import { consentJobIdOk } from './support';
import {
  analyzeCsv,
  consentSummary,
} from '../../../src/modules/crm/contact-import/contact-import.service';
import { extractRow, resolveMapping } from '../../../src/modules/crm/contact-import/import-rows';
import { parseCsv } from '../../../src/modules/crm/contact-import/csv-parser';

describe('the inbox consent line', () => {
  it('words an opt-out and an opt-in, with the keyword the contact typed', () => {
    expect(consentLineBody('withdrawn', 'stop')).toBe(
      'Contact replied STOP: unsubscribed from marketing',
    );
    expect(consentLineBody('granted', ' start ')).toBe(
      'Contact replied START: resubscribed to marketing',
    );
  });
  it('cuts an absurd keyword', () => {
    expect(consentLineBody('withdrawn', 'x'.repeat(200))).toHaveLength(
      'Contact replied : unsubscribed from marketing'.length + 40,
    );
  });
});

describe('the proof CSV line (shared by the direct and the asynchronous export)', () => {
  it('has one cell per header column and a guarded formula', () => {
    const line = proofCsvLine({
      contactUuid: null,
      channel: 'whatsapp',
      purpose: 'marketing',
      action: 'withdrawn',
      source: 'keyword',
      occurredAt: '2026-01-01T00:00:00.000Z',
      recordedAt: '2026-01-01T00:00:01.000Z',
      actorName: '=HYPERLINK("x")',
      note: null,
      evidence: { keyword: 'stop' },
    });
    expect(line.startsWith('(erased),whatsapp,marketing,withdrawn,keyword,')).toBe(true);
    expect(line).toContain("'=HYPERLINK");
    expect(CONSENT_CSV_HEADER).toHaveLength(10);
  });
  it('the direct download and the asynchronous export agree on the cap', () => {
    expect(EXPORT_MAX).toBe(CONSENT_EXPORT_SYNC_MAX);
    expect(consentJobIdOk('0b0e7a0e-0000-4000-8000-000000000000')).toBe(true);
  });
});

describe('the import consent column', () => {
  it.each([
    ['Yes', 'granted'],
    ['y', 'granted'],
    ['TRUE', 'granted'],
    ['1', 'granted'],
    ['Opted-in', 'granted'],
    ['نعم', 'granted'],
    ['No', 'not_granted'],
    ['false', 'not_granted'],
    ['0', 'not_granted'],
    ['Unsubscribed', 'not_granted'],
    ['لا', 'not_granted'],
    ['', 'blank'],
    ['   ', 'blank'],
    ['maybe', 'unrecognised'],
    ['yes please', 'unrecognised'],
  ])('%s is %s', (cell, expected) => {
    expect(parseImportConsent(cell)).toBe(expected);
  });

  it('is auto-detected from a header such as "Marketing consent" but never maps by itself onto another field', () => {
    expect(detectImportColumns(['Name', 'Mobile', 'Marketing Consent'])).toEqual({
      name: 0,
      phone: 1,
      consent: 2,
    });
  });

  const csv = [
    'name,mobile,consent',
    'A,919800000001,yes',
    'B,919800000002,no',
    'C,919800000003,',
    'D,919800000004,perhaps',
    'E,919800000005,Y',
  ].join('\n');

  it('a row carries yes / no / unknown only when a column is mapped', () => {
    const a = analyzeCsv(csv, contactImportOptionsSchema.parse({}));
    expect(a.valid.map((r) => r.consent)).toEqual([
      'granted',
      'not_granted',
      undefined,
      'unrecognised',
      'granted',
    ]);
    expect(a.valid.every((r) => r.consentColumn === true)).toBe(true);
    const s = consentSummary(a)!;
    expect(s).toMatchObject({ granted: 2, notGranted: 2, unrecognised: 1 });
    expect(s.unrecognisedSamples).toEqual(['perhaps']);
  });

  it('unmapped means no event: no column, no summary, no per-row answer', () => {
    const a = analyzeCsv(csv, contactImportOptionsSchema.parse({ mapping: { consent: null } }));
    expect(consentSummary(a)).toBeNull();
    expect(a.valid.every((r) => r.consent === undefined && r.consentColumn === undefined)).toBe(
      true,
    );
  });

  it('a file without the column imports as before', () => {
    const header = ['name', 'mobile'];
    const mapping = resolveMapping(header);
    const r = extractRow({ line: 2, cells: ['A', '919800000001'] }, mapping, header, {});
    expect(r.ok && r.row.consentColumn).toBeFalsy();
    expect(parseCsv('a,b\n1,2').records).toHaveLength(2);
  });
});
