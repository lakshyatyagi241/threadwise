import { callingCodeOf, evaluatePhone, formatPhone, maskPhone, pickDefaultCountry } from './phone';

describe('pickDefaultCountry', () => {
  it('uses the platform country when it is a real one, in any letter case', () => {
    expect(pickDefaultCountry('gb')).toBe('GB');
    expect(pickDefaultCountry(' ae ')).toBe('AE');
  });

  it('falls back to the web default when the platform has none or something unreal', () => {
    expect(pickDefaultCountry(null)).toBe('IN');
    expect(pickDefaultCountry(undefined)).toBe('IN');
    expect(pickDefaultCountry('ZZ')).toBe('IN');
    expect(pickDefaultCountry('')).toBe('IN');
  });
});

describe('evaluatePhone', () => {
  it('reads a number without a plus as a number of the default country', () => {
    expect(evaluatePhone('98765 43210', 'IN')).toEqual({ e164: '+919876543210', valid: true });
  });

  it('reads a number with a plus as international, whatever the default country is', () => {
    expect(evaluatePhone('+44 7911 123456', 'IN')).toEqual({ e164: '+447911123456', valid: true });
  });

  it('refuses numbers that are not real ones', () => {
    expect(evaluatePhone('12345', 'IN')).toEqual({ e164: null, valid: false });
    expect(evaluatePhone('+999 123', 'IN')).toEqual({ e164: null, valid: false });
    expect(evaluatePhone('hello', 'IN')).toEqual({ e164: null, valid: false });
  });

  it('treats an empty field as not valid', () => {
    expect(evaluatePhone('   ', 'IN')).toEqual({ e164: null, valid: false });
  });
});

describe('formatPhone', () => {
  it('writes a valid number the international way', () => {
    expect(formatPhone('9876543210', 'IN')).toBe('+91 98765 43210');
  });

  it('leaves what it cannot read exactly as typed', () => {
    expect(formatPhone('98765', 'IN')).toBe('98765');
    expect(formatPhone('', 'IN')).toBe('');
  });
});

describe('maskPhone', () => {
  it('keeps the calling code and the last two digits, whatever the code length', () => {
    expect(maskPhone('+919876543221')).toBe('+91 •••• ••21');
    expect(maskPhone('+14155550123')).toBe('+1 •••• ••23');
    expect(maskPhone('+971501234567')).toBe('+971 •••• ••67');
  });

  it('hides the calling code when the number is not an international one', () => {
    expect(maskPhone('9876543221')).toBe('•••• ••21');
  });

  it('gives nothing back for text with no digits', () => {
    expect(maskPhone('n/a')).toBe('');
  });
});

describe('callingCodeOf', () => {
  it('shows the plus and the calling code of a country', () => {
    expect(callingCodeOf('IN')).toBe('+91');
    expect(callingCodeOf('US')).toBe('+1');
  });
});
