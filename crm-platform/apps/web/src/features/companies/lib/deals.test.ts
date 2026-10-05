import { describe, expect, it } from 'vitest';
import type { DealResponse } from '@crm/contracts';
import { openFirst } from './deals';

const deal = (title: string, status: DealResponse['status']) => ({ title, status }) as DealResponse;

describe('openFirst (WaDesk: open deals before closed ones)', () => {
  it('puts open deals first and keeps the API order inside each group', () => {
    const rows = [
      deal('won newest', 'won'),
      deal('open newest', 'open'),
      deal('lost', 'lost'),
      deal('open older', 'open'),
      deal('won older', 'won'),
    ];
    expect(openFirst(rows).map((d) => d.title)).toEqual([
      'open newest',
      'open older',
      'won newest',
      'lost',
      'won older',
    ]);
  });

  it('does not change the list it was given', () => {
    const rows = [deal('won', 'won'), deal('open', 'open')];
    openFirst(rows);
    expect(rows.map((d) => d.title)).toEqual(['won', 'open']);
  });
});
