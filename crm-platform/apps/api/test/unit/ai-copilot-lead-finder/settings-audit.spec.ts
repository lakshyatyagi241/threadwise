import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AiCrmCopilotService } from '../../../src/modules/ai-copilot-lead-finder/ai-crm-copilot.service';

/**
 * Switching the WhatsApp staff-channel copilot on or off changes what the workspace's staff can do through an AI, so it must leave an
 * audit row with the old and new value. A toggle that changes nothing is not an event. The service is built without its other
 * dependencies; only the transaction and the audit service are stubbed.
 */
function harness(current: boolean | undefined) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: current === undefined ? [] : [{ wa_copilot_enabled: current }] })
    .mockResolvedValue({ rows: [] });
  const tx = { execute };
  const record = vi.fn(async () => undefined);
  const service = Object.create(AiCrmCopilotService.prototype) as AiCrmCopilotService;
  Object.assign(service, {
    db: { tx: async <T>(fn: (t: unknown) => Promise<T>) => fn(tx) },
    audit: { record },
  });
  const run = (enabled: boolean) =>
    RequestContextStore.run(
      { requestId: 'r', orgId: 7, actorType: 'user', actorId: 3, userId: 3 },
      () => service.setSettings(enabled),
    );
  return { run, record, execute, tx };
}

describe('copilot settings are audited', () => {
  it('records the old and new value when the toggle changes', async () => {
    const { run, record, tx } = harness(false);
    expect(await run(true)).toEqual({ waCopilotEnabled: true });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(tx, {
      module: 'ai_copilot_settings',
      recordId: 7,
      action: 'update',
      delta: { wa_copilot_enabled: { old: false, new: true } },
    });
  });

  it('records turning it off too', async () => {
    const { run, record } = harness(true);
    await run(false);
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ delta: { wa_copilot_enabled: { old: true, new: false } } }),
    );
  });

  it('writes no audit row when nothing changes, but still saves', async () => {
    const { run, record, execute } = harness(true);
    expect(await run(true)).toEqual({ waCopilotEnabled: true });
    expect(record).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(2); // the locking read, then the update
  });

  it('treats a workspace with no settings row as off', async () => {
    const { run, record } = harness(undefined);
    await run(true);
    expect(record).toHaveBeenCalledTimes(1);
  });
});
