import { describe, expect, it, vi } from 'vitest';
import {
  cleanEmail,
  parseEmailCsv,
  parseManualEmails,
  SAMPLE_EMAIL_CSV,
} from '../../../src/modules/campaigns/campaign-rules';
import { CampaignAudienceService } from '../../../src/modules/campaigns/audience.service';

describe('email addresses typed or uploaded for an email campaign', () => {
  it('cleans an address and refuses what is not one', () => {
    expect(cleanEmail('  Asha@Example.COM ')).toBe('asha@example.com');
    expect(cleanEmail('9198123')).toBeNull();
    expect(cleanEmail('a@b')).toBeNull();
  });
  it('reads addresses one per line, or split by commas and semicolons, once each', () => {
    expect(parseManualEmails('a@x.io\nb@x.io, a@x.io; bad\n')).toEqual(['a@x.io', 'b@x.io']);
  });
  it('reads the email column of a file and keeps the other columns for the contact', () => {
    const out = parseEmailCsv(
      'Name,Email,City\nAsha,asha@x.io,Pune\nNo mail,,Delhi\nRavi,RAVI@x.io,\n',
    );
    expect(out.emails).toEqual(['asha@x.io', 'ravi@x.io']);
    expect(out.attrsByEmail.get('asha@x.io')).toEqual({ name: 'Asha', city: 'Pune' });
  });
  it('reads a file with no header as a column of addresses, and the sample file as its own', () => {
    expect(parseEmailCsv('a@x.io\nb@x.io\n').emails).toEqual(['a@x.io', 'b@x.io']);
    expect(parseEmailCsv(SAMPLE_EMAIL_CSV).emails).toEqual([
      'aarav@example.com',
      'priya@example.com',
    ]);
  });
});

describe('the audience of an email campaign', () => {
  it('turns typed addresses and file rows into contacts found by their address, without phone numbers', async () => {
    const resolveManyByIdentity = vi.fn(async (_tx: unknown, _o: number, inputs: unknown[]) =>
      inputs.map((_, i) => ({ outcome: 'created' as const, contactId: 10 + i, uuid: `u${i}` })),
    );
    const repo = {
      contactIdsByUuid: async () => [],
      groupMemberIds: async () => [],
      tagMemberIds: async () => [],
      previousSendContactIds: async () => [],
      mergeAttributes: vi.fn(),
      liveIds: async (_t: unknown, _o: number, ids: number[]) => new Set(ids),
    };
    const service = new CampaignAudienceService(
      repo as never,
      { memberIdsIn: async () => [] } as never,
      { resolveManyByIdentity } as never,
    );
    const ids = await service.resolve({} as never, 1, null, {
      email: true,
      manualNumbers: 'a@x.io\nb@x.io',
      csvText: 'name,email\nAsha,a@x.io\nRavi,c@x.io\n',
    });
    expect(ids).toEqual([10, 11, 12]);
    const inputs = resolveManyByIdentity.mock.calls[0]![2] as Array<{
      kind: string;
      value: string;
      name: string | null;
    }>;
    expect(inputs.every((i) => i.kind === 'email')).toBe(true);
    expect(inputs.map((i) => i.value)).toEqual(['a@x.io', 'b@x.io', 'c@x.io']);
    expect(inputs[0]!.name).toBe('Asha');
  });
});
