import { whatsappLink } from './whatsapp-link';

describe('whatsappLink', () => {
  it('uses the digits of the number, without the plus sign or the spaces', () => {
    expect(whatsappLink('+919812345678')).toBe('https://wa.me/919812345678');
    expect(whatsappLink('+91 98123-45678')).toBe('https://wa.me/919812345678');
  });

  it('is null when there is no number', () => {
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink(undefined)).toBeNull();
    expect(whatsappLink('  ')).toBeNull();
  });
});
