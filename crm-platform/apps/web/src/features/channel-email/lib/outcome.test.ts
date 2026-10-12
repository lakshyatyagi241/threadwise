import { describe, expect, it } from 'vitest';
import { MAIL_CONNECT_OUTCOMES } from '@crm/contracts';
import { outcomeFromParam, outcomeView } from './outcome';

describe('the ?email= outcome the OAuth callback brings back', () => {
  it('reads every outcome the API can send', () => {
    for (const o of MAIL_CONNECT_OUTCOMES) expect(outcomeFromParam(o)).toBe(o);
  });

  it('ignores anything else, so a made-up address cannot show a message', () => {
    expect(outcomeFromParam(null)).toBeNull();
    expect(outcomeFromParam('')).toBeNull();
    expect(outcomeFromParam('hacked')).toBeNull();
    expect(outcomeFromParam('CONNECTED')).toBeNull();
  });

  it('is a success only for connected; refusals warn, failures are errors', () => {
    expect(outcomeView('connected').tone).toBe('success');
    for (const o of ['denied', 'limit', 'not_configured'] as const) {
      expect(outcomeView(o).tone).toBe('warning');
    }
    for (const o of ['missing_scope', 'wrong_account', 'failed'] as const) {
      expect(outcomeView(o).tone).toBe('danger');
    }
  });

  it('gives each outcome its own message key', () => {
    expect(new Set(MAIL_CONNECT_OUTCOMES.map((o) => outcomeView(o).key)).size).toBe(
      MAIL_CONNECT_OUTCOMES.length,
    );
  });
});
