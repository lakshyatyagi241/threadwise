import { describe, expect, it, vi } from 'vitest';
import { ApiLibraryRetentionService } from '../../../src/modules/api-library/api-library-retention.service';
import { CallLogRetentionService } from '../../../src/modules/calling-voice/logging/call-log-retention.service';
import { CallRecordingRetentionService } from '../../../src/modules/calling-voice/call-recording-retention.service';
import { AssignmentRunSweepService } from '../../../src/modules/crm/contact-assignment/assignment-run-sweep.service';
import { FaqRetentionService } from '../../../src/modules/faq-knowledge/faq-retention.service';
import { FlowRunRetentionService } from '../../../src/modules/flow-runtime-engine/runtime/flow-run-retention.service';
import { FormRetentionSweepService } from '../../../src/modules/forms-builder/form-retention-sweep.service';
import { LeadRetentionSweepService } from '../../../src/modules/leads/lead-retention-sweep.service';
import { LeadScoringRetentionService } from '../../../src/modules/lead-scoring/lead-scoring-retention.service';
import { PushSubscriptionsPruneService } from '../../../src/modules/notifications/push-subscriptions-prune.service';
import { WebhookForwardRetentionService } from '../../../src/modules/webhook-fanout/webhook-forward-retention.service';

/**
 * The point of the retention page: a number saved there changes what the nightly job deletes. Each sweep is run against a database that
 * holds a saved policy (or none) and the days it binds into its delete are read back. With no policy the built-in number is used, so
 * saving nothing changes nothing; with one, the saved number replaces it, and a stored number outside the item's range is ignored.
 */

const DAY = 86_400_000;
const NOW = new Date('2027-03-15T12:00:00Z');

function walk(q: unknown, onText: (s: string) => void, onParam: (p: unknown) => void): void {
  for (const c of (q as { queryChunks?: unknown[] }).queryChunks ?? []) {
    if (c !== null && typeof c === 'object') {
      const v = (c as { value?: unknown }).value;
      if (Array.isArray(v)) onText(v.join(''));
      else if ((c as { queryChunks?: unknown[] }).queryChunks) walk(c, onText, onParam);
      else onParam(c);
    } else onParam(c);
  }
}

/** A database holding `saved` live days by item. Every other statement is recorded (text and bound values) and answers "nothing". */
function database(saved: Record<string, number> = {}) {
  const statements: Array<{ text: string; params: unknown[] }> = [];
  const tx = {
    execute: async (q: unknown) => {
      let text = '';
      const params: unknown[] = [];
      walk(
        q,
        (s) => (text += s),
        (p) => params.push(p),
      );
      if (text.includes('FROM data_retention_policies')) {
        const item = String(params[0]);
        const days = saved[item];
        return {
          rows:
            days === undefined
              ? []
              : [
                  {
                    item,
                    live_days: days,
                    archive_days: null,
                    row_version: 1,
                    updated_by: 1,
                    updated_at: NOW.toISOString(),
                  },
                ],
        };
      }
      statements.push({ text, params });
      return { rows: [], rowCount: 0 };
    },
  };
  const db = { privileged: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) };
  return { db, store: { tx: db.privileged }, statements };
}

type Case = {
  item: string;
  builtIn: number;
  /** Runs the sweep with the given policies and returns the days it deleted by. */
  run: (saved: Record<string, number>) => Promise<number>;
};

const cases: Case[] = [
  {
    item: 'faq_match_log',
    builtIn: 90,
    run: async (saved) => {
      const logs = { purgeOlderThan: vi.fn(async () => 0) };
      await new FaqRetentionService(database(saved).db as never, logs as never).sweep();
      return (logs.purgeOlderThan.mock.calls[0] as unknown[])[1] as number;
    },
  },
  {
    item: 'assignment_runs',
    builtIn: 90,
    run: async (saved) => {
      const repo = { pruneRuns: vi.fn(async () => 0) };
      await new AssignmentRunSweepService(database(saved).db as never, repo as never).sweep();
      return (repo.pruneRuns.mock.calls[0] as unknown[])[1] as number;
    },
  },
  {
    item: 'lead_sync_runs',
    builtIn: 90,
    run: async (saved) => {
      const runs = { prune: vi.fn(async () => 0) };
      const svc = new LeadRetentionSweepService(database(saved).db as never, runs as never);
      vi.spyOn(svc, 'sweep').mockResolvedValue(0);
      await svc.run();
      return (runs.prune.mock.calls[0] as unknown[])[1] as number;
    },
  },
  {
    item: 'push_devices_revoked',
    builtIn: 30,
    run: async (saved) => {
      const repo = { pruneRevoked: vi.fn(async () => 0) };
      await new PushSubscriptionsPruneService(database(saved).db as never, repo as never).runOnce(
        NOW,
      );
      const cutoff = (repo.pruneRevoked.mock.calls[0] as unknown[])[1] as Date;
      return Math.round((NOW.getTime() - cutoff.getTime()) / DAY);
    },
  },
  {
    item: 'flow_run_logs',
    builtIn: 30,
    run: async (saved) => {
      const runs = {
        purgeEndedBefore: vi.fn(async () => 0),
        purgeUnusedGraphVersions: vi.fn(async () => 0),
      };
      await new FlowRunRetentionService(database(saved).db as never, runs as never).sweep(NOW);
      const cutoff = (runs.purgeEndedBefore.mock.calls[0] as unknown[])[1] as Date;
      return Math.round((NOW.getTime() - cutoff.getTime()) / DAY);
    },
  },
  {
    item: 'lead_scoring_runs',
    builtIn: 90,
    run: async (saved) => {
      const repo = { deleteOlderThan: vi.fn(async () => 0) };
      const digests = { sweepOld: vi.fn(async () => 0) };
      const config = { getFresh: async () => ({ retentionDays: 90 }) };
      await new LeadScoringRetentionService(
        database(saved).db as never,
        repo as never,
        config as never,
        digests as never,
      ).sweep();
      // The conversation readings follow the same number as the scoring log.
      expect((digests.sweepOld.mock.calls[0] as unknown[])[0]).toBe(
        (repo.deleteOlderThan.mock.calls[0] as unknown[])[1],
      );
      return (repo.deleteOlderThan.mock.calls[0] as unknown[])[1] as number;
    },
  },
  {
    item: 'form_events',
    builtIn: 90,
    run: async (saved) => {
      const d = database(saved);
      await new FormRetentionSweepService(d.db as never).sweepEvents();
      return deletedDays(d.statements, 'DELETE FROM web_form_events');
    },
  },
  {
    item: 'api_library_logs',
    builtIn: 30,
    run: async (saved) => {
      const d = database(saved);
      await new ApiLibraryRetentionService(d.db as never).sweep();
      return deletedDays(d.statements, 'DELETE FROM api_library_logs');
    },
  },
  {
    item: 'webhook_forward_failures',
    builtIn: 14,
    run: async (saved) => {
      const d = database(saved);
      await new WebhookForwardRetentionService(d.store as never).prune();
      return deletedDays(d.statements, 'DELETE FROM webhook_forward_failures');
    },
  },
  {
    item: 'click_calls',
    builtIn: 2,
    run: async (saved) => {
      const d = database(saved);
      await new CallLogRetentionService(d.db as never).sweep();
      return deletedDays(d.statements, 'DELETE FROM telephony_click_calls');
    },
  },
  {
    item: 'call_recordings',
    builtIn: 90,
    run: async (saved) => {
      const repo = { stampUnclocked: vi.fn(async () => 0), expired: vi.fn(async () => []) };
      await new CallRecordingRetentionService(
        database(saved).db as never,
        repo as never,
        {} as never,
        {} as never,
      ).sweep(NOW);
      return (repo.expired.mock.calls[0] as unknown[])[3] as number;
    },
  },
];

function deletedDays(statements: Array<{ text: string; params: unknown[] }>, marker: string) {
  const s = statements.find((x) => x.text.includes(marker));
  expect(s, `${marker} was not issued`).toBeDefined();
  const days = s!.params.find((p) => typeof p === 'number' && p < 1000);
  expect(days).toBeTypeOf('number');
  return days as number;
}

describe.each(cases)('the $item sweep', ({ item, builtIn, run }) => {
  it('keeps its built-in number while nothing is saved', async () => {
    expect(await run({})).toBe(builtIn);
  });

  it('deletes by the number saved on the retention page', async () => {
    expect(await run({ [item]: 12 })).toBe(12);
    expect(await run({ [item]: 20 })).toBe(20);
  });

  it('ignores a stored number outside the item’s range instead of deleting by it', async () => {
    expect(await run({ [item]: 0 })).toBe(builtIn);
    expect(await run({ [item]: 99_999 })).toBe(builtIn);
  });
});

describe('the call recording sweep, on a workspace that chose its own window', () => {
  it('leaves the choice of the workspace to the statement and only replaces the default', async () => {
    const repo = { stampUnclocked: vi.fn(async () => 0), expired: vi.fn(async () => []) };
    await new CallRecordingRetentionService(
      database({ call_recordings: 30 }).db as never,
      repo as never,
      {} as never,
      {} as never,
    ).sweep(NOW);
    // `expired` applies `coalesce(workspace window, default)`: the saved number is passed as the default only.
    expect((repo.expired.mock.calls[0] as unknown[])[3]).toBe(30);
  });
});
