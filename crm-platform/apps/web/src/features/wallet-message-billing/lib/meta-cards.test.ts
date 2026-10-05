import { describe, expect, it } from 'vitest';
import { fileToBase64, formatCardCost, isCardFileName } from './meta-cards';

describe('formatCardCost', () => {
  it('keeps the sub-cent digits Meta prices in, in the currency of the card', () => {
    expect(formatCardCost('0.0118', 'USD', 'en-US')).toBe('$0.0118');
    expect(formatCardCost('0.0014', 'USD', 'en-US')).toBe('$0.0014');
    expect(formatCardCost('0.8631', 'INR', 'en-IN')).toBe('₹0.8631');
  });

  it('shows at least two decimals, and a dash for a price Meta does not list', () => {
    expect(formatCardCost('2.00', 'USD', 'en-US')).toBe('$2.00');
    expect(formatCardCost(null, 'USD', 'en-US')).toBe('—');
  });

  it('falls back to the code and the number for a currency the browser does not know', () => {
    expect(formatCardCost('1.50', 'not-a-code', 'en-US')).toBe('not-a-code 1.50');
  });
});

describe('isCardFileName', () => {
  it('accepts the workbook and a CSV, in any case, and nothing else', () => {
    expect(isCardFileName('Meta INR rates.xlsx')).toBe(true);
    expect(isCardFileName('rates.CSV')).toBe(true);
    expect(isCardFileName('rates.pdf')).toBe(false);
    expect(isCardFileName('rates.xls')).toBe(false);
  });
});

describe('fileToBase64', () => {
  it('round-trips bytes, including a file bigger than one slice', async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    const b64 = await fileToBase64(new Blob([bytes]));
    expect(Buffer.from(b64, 'base64').equals(Buffer.from(bytes))).toBe(true);
  });
});
