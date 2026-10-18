import { describe, expect, it } from 'vitest';
import { GoogleFormPollService } from '../../../src/modules/flow-runtime-engine/runtime/nodes/integrations/google-form-poll.service';
import {
  GoogleAccountError,
  type FormResponseItem,
} from '../../../src/infra/providers/flow-runtime-engine/google-workspace.port';

/**
 * The Google Form node resumes from the form's submissions, read through the connected Google account. The database, the engine, Redis
 * and Google are fakes; the rule under test is who gets which submission.
 */
const at = (s: string) => new Date(`2026-10-18T${s}Z`);
const sub = (
  id: string,
  time: string,
  answers: FormResponseItem['answers'] = {},
): FormResponseItem => ({
  responseId: id,
  respondent: null,
  submittedAt: at(time),
  answers,
});

function setup(opts: {
  waiting: Array<{ org: number; id: number; form: string; since: string }>;
  responses: FormResponseItem[] | GoogleAccountError;
  gone?: number[];
}) {
  const delivered: Array<{ org: number; run: number; data: Record<string, unknown> }> = [];
  const asked: Array<{ org: number; form: string; since: Date }> = [];
  const claims = new Set<string>();
  const db = {
    privileged: async () => ({
      rows: opts.waiting.map((w) => ({
        org_id: w.org,
        id: w.id,
        form_id: w.form,
        last_activity_at: at(w.since),
      })),
    }),
  };
  const engine = {
    deliverExternal: async (
      org: number,
      run: number,
      _h: string,
      data: Record<string, unknown>,
    ) => {
      if (opts.gone?.includes(run)) return 'not_waiting';
      delivered.push({ org, run, data });
      return 'handled';
    },
  };
  const google = {
    formResponses: async (org: number, form: string, since: Date) => {
      asked.push({ org, form, since });
      if (opts.responses instanceof Error) throw opts.responses;
      return opts.responses;
    },
  };
  const redis = {
    set: async (key: string) => {
      if (claims.has(key)) return null;
      claims.add(key);
      return 'OK';
    },
  };
  const svc = new GoogleFormPollService(
    db as never,
    engine as never,
    google as never,
    redis as never,
  );
  return { svc, delivered, asked, claims };
}

describe('GoogleFormPollService', () => {
  it('hands a submission to the run that was waiting on the form, with the answers', async () => {
    const t = setup({
      waiting: [{ org: 7, id: 1, form: 'F1', since: '10:00:00' }],
      responses: [sub('r1', '10:01:00', { Name: 'Ana', Toppings: ['olives', 'feta'] })],
    });
    expect(await t.svc.tickOnce()).toBe(1);
    expect(t.delivered).toEqual([
      {
        org: 7,
        run: 1,
        data: {
          answers: { Name: 'Ana', Toppings: ['olives', 'feta'] },
          responseId: 'r1',
          respondent: null,
        },
      },
    ]);
  });

  it('asks Google only for what is newer than the oldest wait (a little earlier, for clock drift)', async () => {
    const t = setup({
      waiting: [
        { org: 7, id: 2, form: 'F1', since: '10:05:00' },
        { org: 7, id: 1, form: 'F1', since: '10:00:00' },
      ],
      responses: [],
    });
    await t.svc.tickOnce();
    expect(t.asked).toHaveLength(1);
    expect(t.asked[0]!.since.toISOString()).toBe('2026-10-18T09:59:30.000Z');
  });

  it('gives the newest waiting run the submission, the next submission to the other run', async () => {
    const t = setup({
      waiting: [
        { org: 7, id: 1, form: 'F1', since: '10:00:00' },
        { org: 7, id: 2, form: 'F1', since: '10:02:00' },
      ],
      responses: [sub('r1', '10:03:00'), sub('r2', '10:04:00')],
    });
    expect(await t.svc.tickOnce()).toBe(2);
    expect(t.delivered.map((d) => [d.run, d.data.responseId])).toEqual([
      [2, 'r1'],
      [1, 'r2'],
    ]);
  });

  it('ignores a submission made before any run began waiting', async () => {
    const t = setup({
      waiting: [{ org: 7, id: 1, form: 'F1', since: '10:10:00' }],
      responses: [sub('old', '10:00:00')],
    });
    expect(await t.svc.tickOnce()).toBe(0);
    expect(t.delivered).toEqual([]);
    expect(t.claims.size).toBe(0);
  });

  it('delivers a submission once: a second poll finds it claimed', async () => {
    const t = setup({
      waiting: [
        { org: 7, id: 1, form: 'F1', since: '10:00:00' },
        { org: 7, id: 2, form: 'F1', since: '10:00:10' },
      ],
      responses: [sub('r1', '10:01:00')],
    });
    expect(await t.svc.tickOnce()).toBe(1);
    expect(await t.svc.tickOnce()).toBe(0);
    expect(t.delivered).toHaveLength(1);
  });

  it('does not count a run that had already moved on', async () => {
    const t = setup({
      waiting: [{ org: 7, id: 1, form: 'F1', since: '10:00:00' }],
      responses: [sub('r1', '10:01:00')],
      gone: [1],
    });
    expect(await t.svc.tickOnce()).toBe(0);
  });

  it('keeps one workspace apart from another that waits on the same form id', async () => {
    const t = setup({
      waiting: [
        { org: 7, id: 1, form: 'F1', since: '10:00:00' },
        { org: 8, id: 5, form: 'F1', since: '10:00:00' },
      ],
      responses: [sub('r1', '10:01:00')],
    });
    expect(await t.svc.tickOnce()).toBe(2);
    expect(t.asked.map((a) => a.org).sort()).toEqual([7, 8]);
  });

  it('skips quietly when the Google account cannot read the form', async () => {
    const t = setup({
      waiting: [{ org: 7, id: 1, form: 'F1', since: '10:00:00' }],
      responses: new GoogleAccountError('GOOGLE_ACCOUNT_NOT_CONNECTED', 'none', 'forms'),
    });
    expect(await t.svc.tickOnce()).toBe(0);
    expect(t.delivered).toEqual([]);
  });
});
