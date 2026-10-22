import { templateButtonHref } from './template-button';

describe('templateButtonHref', () => {
  it('opens the fixed web address of a link button', () => {
    expect(templateButtonHref({ type: 'url', url: 'https://example.test/offer' })).toBe(
      'https://example.test/offer',
    );
  });

  it('never opens another kind of address, an unfilled one or none', () => {
    expect(templateButtonHref({ type: 'url', url: 'javascript:alert(1)' })).toBeNull();
    expect(templateButtonHref({ type: 'url', url: 'data:text/html,hi' })).toBeNull();
    expect(templateButtonHref({ type: 'url', url: 'https://example.test/{{1}}' })).toBeNull();
    expect(templateButtonHref({ type: 'url', url: 'not a link' })).toBeNull();
    expect(templateButtonHref({ type: 'url' })).toBeNull();
  });

  it('dials the number of a call button, digits and a leading plus only', () => {
    expect(templateButtonHref({ type: 'phone', phone: '+91 99999-99999' })).toBe(
      'tel:+919999999999',
    );
    expect(templateButtonHref({ type: 'phone', phone: '(022) 1234 5678' })).toBe('tel:02212345678');
    expect(templateButtonHref({ type: 'phone', phone: '12;rm' })).toBeNull();
    expect(templateButtonHref({ type: 'phone', phone: null })).toBeNull();
  });

  it('only draws the other kinds of button', () => {
    expect(templateButtonHref({ type: 'quick_reply', url: 'https://example.test' })).toBeNull();
    expect(templateButtonHref({ type: 'copy_code' })).toBeNull();
    expect(templateButtonHref({ type: 'other', phone: '+919999999999' })).toBeNull();
  });
});
