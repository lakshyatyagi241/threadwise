import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WizardRunService } from '../../../src/modules/campaigns/wizard/wizard-run.service';
import {
  buildLab,
  group,
  makeDraft,
  payPerMessage,
  people,
  readyDraft,
  startHarness,
  wiz,
  world,
  type Lab,
  type World,
} from './broadcast-wizard.support';

/**
 * A recurring broadcast with several templates (an addition: Reference's recurring campaign repeats one): the runs take the templates in
 * turn, round and round, each with its own variable mapping. Real Postgres, the sandbox sender, our own clock.
 */
let lab: Lab;

beforeAll(async () => {
  lab = buildLab(await startHarness());
}, 240_000);

afterAll(async () => {
  await lab?.h.stop();
});

const owner = () => lab.h.owner;
beforeEach(async () => {
  await owner().query(`UPDATE camp_series SET status = 'cancelled' WHERE status = 'active'`);
});
const at = (iso: string) => {
  lab.clock.now = new Date(iso);
};

/** Another approved template on the world's number, with its own body. */
async function extraTemplate(w: World, name: string, body: string) {
  const cfg = (
    await owner().query(`SELECT id FROM wa_provider_configs WHERE org_id = $1 AND uuid = $2`, [
      w.t.orgId,
      w.config,
    ])
  ).rows[0] as { id: number };
  const t = await owner().query(
    `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status, language, meta_category, category,
                               provider_config_id, variable_map)
     VALUES ($1, $2, $3, 'standard', 'approved', 'en_US', 'marketing', 'marketing', $4, $5::jsonb) RETURNING uuid, template_name`,
    [
      w.t.orgId,
      name,
      body,
      cfg.id,
      JSON.stringify({ body: [{ num: 1, key: 'first_name', example: 'Asha' }] }),
    ],
  );
  return { uuid: t.rows[0].uuid as string, name: t.rows[0].template_name as string };
}

const mapping = (text: string) => ({ 'body.1': { kind: 'fixed', text } });
const recurring = {
  mode: 'recurring',
  rule: {
    frequency: 'daily',
    interval: 1,
    timeOfDay: '09:00',
    timezone: 'UTC',
    weekdays: [],
    startDate: '2027-04-01',
    ends: { kind: 'never' },
  },
};

async function draftWith(w: World, over: Record<string, unknown>) {
  await payPerMessage(lab, w.t, 5_000_000);
  const ids = await people(lab, w.t, [{}, {}]);
  const g = await group(owner(), w.t, `G${Math.random()}`, ids);
  return makeDraft(lab, w, readyDraft(w, g, over));
}

const launch = (w: World, d: { id: string; rowVersion: number }) =>
  wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, { rowVersion: d.rowVersion });

describe('launching a recurring broadcast with a template sequence', () => {
  it('needs a recurring schedule, no A/B test, a template on every entry and a mapping for its placeholders', async () => {
    const w = await world(lab, 'seq-rules');
    const t2 = await extraTemplate(w, 'seq_two', 'Hello {{1}}, part two.');
    const entry = { templateId: t2.uuid, variables: mapping('x') };

    const now = await draftWith(w, { templateSequence: [entry] });
    const notRecurring = await launch(w, now);
    expect(notRecurring.status).toBe(422);
    expect(JSON.stringify(notRecurring.body)).toContain('sequence_not_recurring');

    const t3 = await extraTemplate(w, 'seq_three', 'Hi {{1}}.');
    const ab = await draftWith(w, {
      schedule: recurring,
      abTesting: true,
      templateIdB: t3.uuid,
      variablesB: mapping('b'),
      templateSequence: [entry],
    });
    expect(JSON.stringify((await launch(w, ab)).body)).toContain('sequence_with_ab');

    const blank = await draftWith(w, {
      schedule: recurring,
      templateSequence: [{ templateId: null, variables: {} }],
    });
    expect(JSON.stringify((await launch(w, blank)).body)).toContain('sequence_template_required');

    const unmapped = await draftWith(w, {
      schedule: recurring,
      templateSequence: [{ templateId: t2.uuid, variables: {} }],
    });
    const res = await launch(w, unmapped);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('templateSequence.0.variables.body.1');

    const missing = await draftWith(w, {
      schedule: recurring,
      templateSequence: [
        { templateId: '00000000-0000-4000-8000-000000000000', variables: mapping('x') },
      ],
    });
    expect(JSON.stringify((await launch(w, missing)).body)).toContain('sequence_template_required');
  });

  it('accepts a sequence of two more templates and keeps it on the series', async () => {
    const w = await world(lab, 'seq-ok');
    const t2 = await extraTemplate(w, 'seq_ok_two', 'Two for {{1}}');
    const t3 = await extraTemplate(w, 'seq_ok_three', 'Three for {{1}}');
    const d = await draftWith(w, {
      schedule: recurring,
      templateSequence: [
        { templateId: t2.uuid, variables: mapping('two') },
        { templateId: t3.uuid, variables: mapping('three') },
      ],
    });
    const res = await launch(w, d);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.kind).toBe('series');
    const detail = await wiz(lab, w.t.admin).get(`/broadcasts/${res.body.id}`);
    expect(detail.body.templateCount).toBe(3);
  });
});

describe('the wallet and a template that cannot be sent', () => {
  it('checks the wallet for every template of the sequence at launch, each at its own rate', async () => {
    const w = await world(lab, 'seq-wallet');
    const t2 = await extraTemplate(w, 'seq_w_two', 'Two for {{1}}');
    const t3 = await extraTemplate(w, 'seq_w_three', 'Three for {{1}}');
    const d = await draftWith(w, {
      schedule: recurring,
      templateSequence: [
        { templateId: t2.uuid, variables: mapping('two') },
        { templateId: t3.uuid, variables: mapping('three') },
      ],
    });
    const spy = vi.spyOn(WizardRunService.prototype, 'preflight');
    try {
      lab.clock.now = new Date();
      expect((await launch(w, d)).status).toBe(200);
      const used = spy.mock.calls.map((c) => (c[3] as { uuid: string }).uuid);
      expect(used).toEqual([w.template, t2.uuid, t3.uuid]);
    } finally {
      spy.mockRestore();
    }
  });

  it('passes over a template that is paused for the next one in the turn, and fails the run only when none can be sent', async () => {
    const w = await world(lab, 'seq-paused');
    const t2 = await extraTemplate(w, 'seq_p_two', 'Two for {{1}}');
    const t3 = await extraTemplate(w, 'seq_p_three', 'Three for {{1}}');
    const d = await draftWith(w, {
      schedule: recurring,
      templateSequence: [
        { templateId: t2.uuid, variables: mapping('two') },
        { templateId: t3.uuid, variables: mapping('three') },
      ],
    });
    lab.clock.now = new Date();
    const res = await launch(w, d);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const series = (
      await owner().query(`SELECT id FROM camp_series WHERE uuid = $1`, [res.body.id])
    ).rows[0];
    const used = async () =>
      (
        await owner().query(
          `SELECT t.template_name FROM wpcampaigns c JOIN wa_templates t ON t.id = c.template_id
           WHERE c.series_id = $1 ORDER BY c.occurrence_no`,
          [series.id],
        )
      ).rows.map((r) => r.template_name as string);

    // Run 1 is the first template. Template 2 is paused until the end of the week, so run 2 sends template 3 instead.
    at('2027-04-01T09:00:00Z');
    await lab.series.tick();
    await owner().query(
      `UPDATE wa_templates SET paused_until = '2027-04-08T00:00:00Z' WHERE uuid = $1`,
      [t2.uuid],
    );
    at('2027-04-02T09:00:00Z');
    await lab.series.tick();
    expect((await used()).slice(1)).toEqual(['seq_p_three']);

    // Every template unsendable: the run is made and fails with the reason, the series goes on.
    await owner().query(
      `UPDATE wa_templates SET paused_until = '2027-04-08T00:00:00Z' WHERE uuid IN ($1, $2)`,
      [t3.uuid, w.template],
    );
    at('2027-04-03T09:00:00Z');
    expect(await lab.series.tick()).toBe(1);
    const last = (
      await owner().query(
        `SELECT status FROM wpcampaigns WHERE series_id = $1 ORDER BY occurrence_no DESC LIMIT 1`,
        [series.id],
      )
    ).rows[0];
    expect(['failed', 'running']).toContain(last.status);
  });
});

describe('the runs of a series take the templates in turn', () => {
  it('run 1 sends the first template, run 2 the next, run 3 the third, run 4 the first again, each with its own mapping', async () => {
    const w = await world(lab, 'seq-rotate');
    const t2 = await extraTemplate(w, 'seq_rot_two', 'Two for {{1}}');
    const t3 = await extraTemplate(w, 'seq_rot_three', 'Three for {{1}}');
    const d = await draftWith(w, {
      schedule: recurring,
      templateSequence: [
        { templateId: t2.uuid, variables: mapping('two') },
        { templateId: t3.uuid, variables: mapping('three') },
      ],
    });
    lab.clock.now = new Date();
    const res = await launch(w, d);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const series = (
      await owner().query(`SELECT id, org_id FROM camp_series WHERE uuid = $1`, [res.body.id])
    ).rows[0];

    const names: string[] = [];
    for (const day of ['01', '02', '03', '04']) {
      at(`2027-04-${day}T09:00:00Z`);
      lab.sent.length = 0;
      expect(await lab.series.tick()).toBe(1);
      const run = (
        await owner().query(
          `SELECT id, template_id, wizard FROM wpcampaigns WHERE series_id = $1 ORDER BY occurrence_no DESC LIMIT 1`,
          [series.id],
        )
      ).rows[0];
      expect(await lab.run(Number(series.org_id), Number(run.id))).toBe('finished');
      names.push(lab.sent[0]!.templateName);
      // The run's own draft carries its template and mapping, and no sequence of its own (a retry reads them from here).
      expect(run.wizard.draft.templateSequence).toEqual([]);
      if (day === '02') expect(run.wizard.draft.variables).toEqual(mapping('two'));
      if (day === '03') expect(run.wizard.draft.variables).toEqual(mapping('three'));
    }
    const first = (
      await owner().query(`SELECT template_name FROM wa_templates WHERE uuid = $1`, [w.template])
    ).rows[0].template_name as string;
    expect(names).toEqual([first, 'seq_rot_two', 'seq_rot_three', first]);

    const detail = await wiz(lab, w.t.admin).get(`/broadcasts/${res.body.id}`);
    // The runs, newest first, each with the template it sent.
    expect(detail.body.runList.map((r: { templateName: string | null }) => r.templateName)).toEqual(
      [first, 'seq_rot_three', 'seq_rot_two', first],
    );
    expect(detail.body.templateCount).toBe(3);
  });

  it('a series without a sequence sends its one template every time', async () => {
    const w = await world(lab, 'seq-one');
    const d = await draftWith(w, { schedule: recurring });
    lab.clock.now = new Date();
    const res = await launch(w, d);
    expect(res.status).toBe(200);
    const series = (
      await owner().query(`SELECT id, org_id FROM camp_series WHERE uuid = $1`, [res.body.id])
    ).rows[0];
    const seen = new Set<string>();
    for (const day of ['01', '02', '03']) {
      at(`2027-04-${day}T09:00:00Z`);
      lab.sent.length = 0;
      await lab.series.tick();
      const run = (
        await owner().query(
          `SELECT id FROM wpcampaigns WHERE series_id = $1 ORDER BY occurrence_no DESC LIMIT 1`,
          [series.id],
        )
      ).rows[0];
      await lab.run(Number(series.org_id), Number(run.id));
      seen.add(lab.sent[0]!.templateName);
    }
    expect(seen.size).toBe(1);
    expect((await wiz(lab, w.t.admin).get(`/broadcasts/${res.body.id}`)).body.templateCount).toBe(
      1,
    );
  });
});
