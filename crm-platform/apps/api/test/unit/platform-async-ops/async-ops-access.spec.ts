import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { outboxReplayRequestSchema, wabaReplayRequestSchema } from '@crm/contracts';
import { OperatorGuard } from '../../../src/modules/auth';
import { OPERATOR_ROLES_KEY } from '../../../src/modules/auth/guards/auth-gates';
import { AsyncOpsController } from '../../../src/modules/platform-async-ops/async-ops.controller';

const dir = resolve(__dirname, '../../../src/modules/platform-async-ops');

describe('platform async ops access', () => {
  it('only async-ops.store.ts opens a privileged transaction', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
    const offenders = files.filter((f) =>
      readFileSync(join(dir, f), 'utf8').includes('.privileged('),
    );
    expect(offenders).toEqual(['async-ops.store.ts']);
  });

  it('the controller runs behind OperatorGuard', () => {
    expect(Reflect.getMetadata('__guards__', AsyncOpsController)).toContain(OperatorGuard);
  });

  it.each(['replayOutbox', 'replayWaba', 'replayWebhookRetry'] as const)(
    '%s needs a super admin',
    (handler) => {
      const proto = AsyncOpsController.prototype;
      expect(Reflect.getMetadata(OPERATOR_ROLES_KEY, proto[handler])).toEqual(['super_admin']);
    },
  );

  it.each(['deadOutbox', 'failedWaba', 'failedWebhookRetry'] as const)(
    '%s is readable by any operator',
    (handler) => {
      const proto = AsyncOpsController.prototype;
      expect(Reflect.getMetadata(OPERATOR_ROLES_KEY, proto[handler])).toBeUndefined();
    },
  );

  it('replay requests carry only a type and a count, never a payload', () => {
    expect(Object.keys(outboxReplayRequestSchema.shape).sort()).toEqual(['eventType', 'limit']);
    expect(Object.keys(wabaReplayRequestSchema.shape)).toEqual(['limit']);
  });
});
