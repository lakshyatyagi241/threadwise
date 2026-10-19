import { describe, expect, it } from 'vitest';
import { waFormSchema } from '@crm/contracts';
import { toWaFormResponse } from '../../../src/modules/forms-links-groups/wa-forms.mapper';
import type { WaFormRow } from '../../../src/modules/forms-links-groups/wa-forms.repository';

const base = {
  uuid: '9290bf80-43b8-47db-95a1-352ce5382891',
  title: 'T',
  purpose: null,
  slug: 's',
  audience_type: 'appointment',
  submission_cap: 0,
  cap_reached_note: null,
  send_button_label: 'Book',
  thank_you_note: null,
  status: 'published',
  meta_flow_id: 'F1',
  published_at: null,
  publish_error: null,
  submission_count: 0,
  created_at_iso: '2026-10-12T06:11:49.518Z',
  row_version: 1,
} as unknown as WaFormRow;

describe('toWaFormResponse legacy normalization', () => {
  it('turns Reference-shaped rows into contract-valid output', () => {
    const row = {
      ...base,
      definition_json: {
        screens: [
          {
            id: 'WHEN',
            title: 'When',
            fields: [
              { type: 'date', name: 'day', label: 'Day', required: true },
              {
                type: 'radio',
                name: 'slot',
                label: 'Slot',
                options: [{ id: 'am', title: 'Morning' }],
              },
            ],
          },
        ],
      },
    } as unknown as WaFormRow;
    const out = toWaFormResponse(row);
    expect(waFormSchema.safeParse(out).success).toBe(true);
    expect(out.audienceType).toBe('appointment_booking');
    expect(out.definition.screens[0]!.fields[1]).toMatchObject({
      id: 'slot',
      kind: 'radio_buttons',
      options: ['Morning'],
    });
    expect(out.fieldsCount).toBe(2);
  });

  it('maps unknown audience to other and empty definition to one screen', () => {
    const out = toWaFormResponse({
      ...base,
      audience_type: 'weird',
      definition_json: null,
    } as unknown as WaFormRow);
    expect(out.audienceType).toBe('other');
    expect(out.definition.screens).toHaveLength(1);
  });
});
