import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './support';

/**
 * The worker process builds its own module graph (`worker.module.ts`), separate from the API's. A provider that only the API graph can
 * resolve breaks the worker at start-up, which no HTTP e2e notices: this boots the real worker module against the harness database.
 * (A release once crash-looped the worker because the key guard, a provider of a module the workers import, needed a service that only
 * the API graph supplied.)
 */
describe('worker process boot', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 240_000);
  afterAll(async () => h.stop());

  it('resolves every dependency of the worker module graph', async () => {
    const { WorkerModule } = await import('../../../src/worker.module');
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  }, 120_000);
});
