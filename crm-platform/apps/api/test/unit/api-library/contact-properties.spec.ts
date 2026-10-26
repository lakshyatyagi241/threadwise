import { describe, expect, it, vi } from 'vitest';
import { apiLibraryContactPropertiesResponseSchema } from '@crm/contracts';
import { ApiLibraryService } from '../../../src/modules/api-library/api-library.service';

function service(custom: Array<{ key: string; name: string; type?: string }> = []) {
  const attributes = { pickerFeed: vi.fn(async () => ({ custom })) };
  return new ApiLibraryService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    attributes as never,
  );
}

describe('the contact properties an API can read and write', () => {
  it('offers the contact details a variable can read, none of them as a place to save an answer', async () => {
    const out = await service([{ key: 'city', name: 'City' }]).contactProperties();
    apiLibraryContactPropertiesResponseSchema.parse(out);
    const readOnly = out.data.filter((p) => p.readOnly).map((p) => p.key);
    expect(readOnly).toEqual([
      'phone',
      'middle_name',
      'memo',
      'source',
      'lifecycle_stage',
      'status',
      'groups',
      'owner',
      'opt_out',
    ]);
    expect(out.data.find((p) => p.key === 'phone')!.label).toBe('Mobile number');
  });
  it('keeps the writable fields and the custom properties writable', async () => {
    const out = await service([{ key: 'city', name: 'City' }]).contactProperties();
    const writable = out.data.filter((p) => !p.readOnly).map((p) => p.key);
    expect(writable).toEqual([
      'name',
      'first_name',
      'last_name',
      'email',
      'title',
      'language',
      'address',
      'city',
    ]);
  });
  it('a custom property that reuses a built-in key is not listed twice', async () => {
    const out = await service([{ key: 'memo', name: 'Memo again' }]).contactProperties();
    expect(out.data.filter((p) => p.key === 'memo')).toHaveLength(1);
  });
});
