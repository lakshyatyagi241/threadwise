import { describe, expect, it } from 'vitest';
import { ExportKeeper } from '../../../src/modules/crm/contact-bulk/export-file';

describe('ExportKeeper (a streamed export kept for a re-download)', () => {
  it('keeps every line of a file within the limit, in order', () => {
    const keeper = new ExportKeeper(3);
    keeper.add('a,b\n');
    keeper.add('1,2\n');
    expect(keeper.csv?.toString('utf8')).toBe('a,b\n1,2\n');
  });

  it('keeps nothing once the file goes over the limit, so the whole file is never held in memory', () => {
    const keeper = new ExportKeeper(2);
    keeper.add('a\n');
    keeper.add('b\n');
    keeper.add('c\n');
    keeper.add('d\n');
    expect(keeper.csv).toBeNull();
  });

  it('an empty export keeps an empty file, not nothing', () => {
    expect(new ExportKeeper(2).csv?.length).toBe(0);
  });
});
