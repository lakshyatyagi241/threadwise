import { createElement } from 'react';
import { useTranslations } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { renderWithMessages } from './render-test-utils';

function Reads({ name }: { name: string }) {
  const t = useTranslations('auth-registration-security.platform.common');
  return createElement('span', null, t(name));
}

describe('renderWithMessages', () => {
  it('renders a component with the real messages', () => {
    expect(renderWithMessages(createElement(Reads, { name: 'retry' }))).toContain('Try again');
    expect(renderWithMessages(createElement(Reads, { name: 'retry' }), { locale: 'ar' })).toContain(
      'حاول مرة أخرى',
    );
  });

  it('fails loudly on a message that does not exist, which is what makes the render tests worth anything', () => {
    expect(() => renderWithMessages(createElement(Reads, { name: 'noSuchKey' }))).toThrow(
      /Missing or broken messages/,
    );
  });
});
