import { describe, expect, it } from 'vitest';
import {
  canDismiss,
  confirmReveal,
  dismissReveal,
  needsLeaveGuard,
  revealOf,
  sampleCurl,
} from './reveal';

const secrets = {
  token: 'tkn_abc',
  hookPath: '/v2/public/lead-hooks/tkn_abc',
  hookUrl: 'https://api.acme.test/v2/public/lead-hooks/tkn_abc',
  hookUrlProblem: null,
};

describe('reveal state machine', () => {
  it('starts shown and unconfirmed', () => {
    const r = revealOf(secrets, 'created');
    expect(r).toEqual({ ...secrets, reason: 'created', confirmed: false });
    expect(canDismiss(r)).toBe(false);
  });

  it('cannot be dismissed without the confirmation: the token is never dropped by accident', () => {
    const r = revealOf(secrets, 'rotated');
    expect(dismissReveal(r)).toBe(r);
    expect(needsLeaveGuard(r)).toBe(true);
  });

  it('goes away only after the person confirms, and the confirmation can be taken back', () => {
    const r = revealOf(secrets, 'created');
    const ok = confirmReveal(r, true);
    expect(canDismiss(ok)).toBe(true);
    expect(dismissReveal(ok)).toBeNull();
    const undone = confirmReveal(ok, false);
    expect(dismissReveal(undone)).toBe(undone);
  });

  it('has nothing to dismiss or guard once it is gone', () => {
    expect(dismissReveal(null)).toBeNull();
    expect(canDismiss(null)).toBe(false);
    expect(needsLeaveGuard(null)).toBe(false);
  });

  it('does not change the original when confirming', () => {
    const r = revealOf(secrets, 'created');
    confirmReveal(r, true);
    expect(r.confirmed).toBe(false);
  });
});

describe('sampleCurl', () => {
  it('posts JSON to the URL', () => {
    const c = sampleCurl('https://api.acme.test/v2/public/lead-hooks/t', false);
    expect(c).toContain("curl -X POST 'https://api.acme.test/v2/public/lead-hooks/t'");
    expect(c).toContain('Content-Type: application/json');
    expect(c).not.toContain('x-webhook-secret');
    expect(c).toContain('+12025550123');
  });

  it('adds the secret header only when the source has a secret, and never a secret value', () => {
    const c = sampleCurl('https://a.test/h', true);
    expect(c).toContain('x-webhook-secret: <your shared secret>');
  });

  it('uses a placeholder address when the origin is unknown', () => {
    expect(sampleCurl(null, false)).toContain('<your-api-address>/v2/public/lead-hooks/<token>');
  });
});
