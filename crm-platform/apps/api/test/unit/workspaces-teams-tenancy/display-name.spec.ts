import { describe, expect, it } from 'vitest';
import { createWspTeamSchema, inviteWspMemberSchema } from '@crm/contracts';

const ROLE = '5afcfeda-11ce-4e2f-bb97-5de36d09834e';

describe('display names (members and teams)', () => {
  it('strips whitespace and invisible characters from both ends, keeps them inside', () => {
    const r = inviteWspMemberSchema.parse({
      fullName: '​ Ab​cd‍﻿ ',
      email: 'a@b.test',
      roleId: ROLE,
    });
    expect(r.fullName).toBe('Ab​cd');
    expect(createWspTeamSchema.parse({ name: ' Sales‍' }).name).toBe('Sales');
  });

  it('a name made only of invisible characters is empty, so it is refused', () => {
    expect(
      inviteWspMemberSchema.safeParse({ fullName: '​‍', email: 'a@b.test', roleId: ROLE }).success,
    ).toBe(false);
    expect(createWspTeamSchema.safeParse({ name: ' ﻿ ' }).success).toBe(false);
  });

  it('the length limit still applies after trimming', () => {
    expect(createWspTeamSchema.safeParse({ name: 'x'.repeat(65) }).success).toBe(false);
    expect(createWspTeamSchema.safeParse({ name: 'x'.repeat(64) }).success).toBe(true);
  });
});
