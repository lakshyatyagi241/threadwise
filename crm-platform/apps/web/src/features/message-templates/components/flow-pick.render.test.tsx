import { describe, expect, it } from 'vitest';
import type { WaFormPickerItem } from '@crm/contracts';
import {
  makeSession,
  renderAccount,
  type Seed,
} from '@/features/auth-registration-security/account/render-test-utils';
import { newRow } from '../lib/buttons';
import { FlowPick } from './flow-pick';

const item = (over: Partial<WaFormPickerItem>): WaFormPickerItem => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Booking',
  status: 'published',
  isPublished: true,
  metaFlowId: '1234567890',
  firstScreenId: 'A',
  ...over,
});

function render(forms: WaFormPickerItem[], flowId = '') {
  const seed: Seed = [[['tpl', 'wa-forms-picker'], { forms }]];
  const row = { ...newRow('form', 'k1'), flowId };
  return renderAccount(<FlowPick row={row} id="f" onPick={() => undefined} />, {
    session: makeSession({}),
    seed,
  });
}

describe('the Form button picks a WhatsApp Form that exists at Meta', () => {
  it('offers a published form whose Flow ID is a Meta number', () => {
    const html = render([item({})]);
    expect(html).toContain('>Booking<');
  });
  it('lists a form whose Flow ID is not a number as not usable yet, instead of offering it', () => {
    const html = render([
      item({
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Seeded',
        metaFlowId: 'seed-flow-1',
      }),
    ]);
    expect(html).toContain('Seeded (publish it to Meta first)');
    expect(html).toContain('disabled');
    expect(html).not.toContain('value="seed-flow-1"');
  });
});
