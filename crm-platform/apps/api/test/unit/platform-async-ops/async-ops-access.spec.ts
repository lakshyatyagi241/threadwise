import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = resolve(__dirname, '../../../src/modules/platform-async-ops');
const read = (f: string) => readFileSync(join(dir, f), 'utf8');

describe('platform async ops access', () => {
  it('only async-ops.store.ts opens a privileged transaction', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
    const offenders = files.filter((f) => read(f).includes('.privileged('));
    expect(offenders).toEqual(['async-ops.store.ts']);
  });

  it('every route is operator-only, and every replay needs a super admin', () => {
    const c = read('async-ops.controller.ts');
    expect(c).toContain("@ActorKinds('platform_operator')");
    expect(c).toContain('@UseGuards(OperatorGuard)');
    const posts = c.split('@Post(').slice(1);
    expect(posts).toHaveLength(2);
    for (const p of posts) expect(p.slice(0, 120)).toContain("@OperatorRoles('super_admin')");
  });

  it('replay takes no payload from the caller', () => {
    const contracts = readFileSync(
      resolve(__dirname, '../../../../../packages/contracts/src/platform-async-ops/index.ts'),
      'utf8',
    );
    const requests = contracts.split('export const').filter((b) => b.startsWith(' outboxReplayRequestSchema') || b.startsWith(' wabaReplayRequestSchema'));
    expect(requests).toHaveLength(2);
    for (const r of requests) expect(r).not.toMatch(/payload|data|body/i);
  });
});
