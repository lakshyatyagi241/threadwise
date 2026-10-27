import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { WaFormsService } from '../../../src/modules/forms-links-groups/wa-forms.service';

/**
 * Issue #1166: exporting a WhatsApp form's submissions (names, phone numbers, answers) wrote no audit row, while the forms-builder
 * export does. The export is a read of personal data, so it must be recorded in the same transaction.
 */
describe('WhatsApp form CSV export is audited (#1166)', () => {
  it('records one export row for the form, with how many submissions left', async () => {
    const record = vi.fn(async () => undefined);
    const repo = {
      findByUuid: async () => ({ id: 9, slug: 'lead-form', definition_json: {} }),
      submissionsForExport: async () => [
        {
          submitted_at: new Date('2026-10-01T10:00:00Z'),
          contact_name: 'A',
          contact_phone: '1',
          answers_json: {},
        },
        {
          submitted_at: new Date('2026-10-02T10:00:00Z'),
          contact_name: 'B',
          contact_phone: '2',
          answers_json: {},
        },
      ],
    };
    const service = new WaFormsService(
      { tx: async (fn: (tx: unknown) => unknown) => fn({}) } as never,
      repo as never,
      { record } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const out = await RequestContextStore.run({ orgId: 1, userId: 2 } as never, () =>
      service.submissionsCsv('form-uuid'),
    );
    expect(out.filename).toBe('lead-form-submissions.csv');
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        module: 'wa_forms',
        recordId: 9,
        action: 'export',
        delta: { submissions: { old: null, new: 2 } },
      }),
    );
  });
});
