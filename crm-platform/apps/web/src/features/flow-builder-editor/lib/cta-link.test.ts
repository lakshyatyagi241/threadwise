import { describe, expect, it } from 'vitest';
import { ctaLinkProblem } from './cta-link';

describe('ctaLinkProblem', () => {
  it('accepts a good target for each kind', () => {
    expect(ctaLinkProblem('url', 'https://example.com/a?b=1')).toBeNull();
    expect(ctaLinkProblem('email', 'name@example.com')).toBeNull();
    expect(ctaLinkProblem('phone', '+91 98765 43210')).toBeNull();
  });

  it('flags a value of the wrong shape for the kind', () => {
    expect(ctaLinkProblem('email', 'https://example.com')).toBe('email');
    expect(ctaLinkProblem('phone', 'https://example.com')).toBe('phone');
    expect(ctaLinkProblem('phone', '123')).toBe('phone');
    expect(ctaLinkProblem('url', 'example')).toBe('url');
    expect(ctaLinkProblem('url', 'javascript:alert(1)')).toBe('url');
  });

  it('leaves empty values and merge tokens to other checks', () => {
    expect(ctaLinkProblem('email', '')).toBeNull();
    expect(ctaLinkProblem('url', '{{site}}')).toBeNull();
  });
});
