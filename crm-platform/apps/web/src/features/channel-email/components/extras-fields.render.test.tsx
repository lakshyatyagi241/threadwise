import { describe, expect, it } from 'vitest';
import { EMPTY_EXTRAS } from '../lib/composer-extras';
import { EmailExtrasFields } from './extras-fields';
import { render } from './render-utils';

const fields = (value = EMPTY_EXTRAS, showProblems = false) =>
  render(
    <EmailExtrasFields
      value={value}
      onChange={() => undefined}
      defaultSubject="Re: Order"
      showProblems={showProblems}
    />,
  );

describe('email composer fields', () => {
  it('are folded away until asked for', () => {
    const html = fields();
    expect(html).toContain('data-testid="email-extras-toggle"');
    expect(html).not.toContain('data-testid="email-cc"');
  });

  it('open on their own when something is filled, with Re: as the subject hint', () => {
    const html = fields({ cc: 'a@x.io', bcc: '', subject: '' });
    expect(html).toContain('data-testid="email-cc"');
    expect(html).toContain('data-testid="email-bcc"');
    expect(html).toContain('placeholder="Re: Order"');
  });

  it('name the bad addresses only after a send was tried', () => {
    const bad = { cc: 'a@x.io, nope', bcc: '', subject: '' };
    expect(fields(bad, false)).not.toContain('role="alert"');
    expect(fields(bad, true)).toContain('These Cc addresses are not valid: nope');
  });
});
