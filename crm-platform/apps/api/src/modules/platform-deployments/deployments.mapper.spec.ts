import { describe, expect, it } from 'vitest';
import { DEPLOYMENT_ERROR_MAX_CHARS } from '@crm/contracts';
import {
  toDeploymentCounts,
  toDeploymentRow,
  toPublishCounts,
  toPublishRow,
  toReleaseRow,
  toReleasesResponse,
} from './deployments.mapper';

/** The dashboard row: exact status and step from the stored row, the Geta error cut to its limit, timestamps as ISO text. */
const base = {
  id: '6f1e0c1a-0000-4000-8000-000000000001',
  workspace_id: '6f1e0c1a-0000-4000-8000-000000000002',
  workspace_name: 'Acme',
  flow_id: '6f1e0c1a-0000-4000-8000-000000000003',
  flow_name: 'Welcome',
  publish_version: 3,
  status: 'running',
  step: 'publish_bot',
  failed_step: null,
  last_error: null,
  attempted_at: new Date('2026-10-19T10:00:00Z'),
  updated_at: new Date('2026-10-19T10:00:01Z'),
  stalled: false,
};

describe('toDeploymentRow', () => {
  it('maps a running row to the wire shape', () => {
    expect(toDeploymentRow(base)).toEqual({
      id: base.id,
      workspaceId: base.workspace_id,
      workspaceName: 'Acme',
      flowId: base.flow_id,
      flowName: 'Welcome',
      publishVersion: 3,
      status: 'running',
      step: 'publish_bot',
      failedStep: null,
      lastError: null,
      attemptedAt: '2026-10-19T10:00:00.000Z',
      updatedAt: '2026-10-19T10:00:01.000Z',
      stalled: false,
    });
  });

  it('keeps a queued row without an attempt as null, not an empty string', () => {
    const row = toDeploymentRow({
      ...base,
      status: 'queued',
      step: 'configuration_update',
      attempted_at: null,
    });
    expect(row.status).toBe('queued');
    expect(row.attemptedAt).toBeNull();
  });

  it('cuts a long Geta error to the dashboard limit', () => {
    const row = toDeploymentRow({
      ...base,
      status: 'failed',
      failed_step: 'publish_bot',
      last_error: 'x'.repeat(DEPLOYMENT_ERROR_MAX_CHARS + 50),
    });
    expect(row.lastError).toHaveLength(DEPLOYMENT_ERROR_MAX_CHARS);
  });

  it('reports a stalled pending row', () => {
    expect(toDeploymentRow({ ...base, stalled: true }).stalled).toBe(true);
  });

  it('rejects a status the contract does not know', () => {
    expect(() => toDeploymentRow({ ...base, status: 'idle' })).toThrow();
  });
});

describe('toDeploymentCounts', () => {
  it('turns database counts into numbers and treats missing ones as zero', () => {
    expect(toDeploymentCounts({ running: 1, queued: '2', failed: 0 })).toEqual({
      running: 1,
      queued: 2,
      failed: 0,
      live: 0,
      stalled: 0,
    });
  });
});

/** A flow publish (outbox event): the worker's state, attempts and the error, cut to the same limit. */
const publish = {
  workspace_id: '6f1e0c1a-0000-4000-8000-0000000000b1',
  workspace_name: 'Acme Retail',
  flow_id: '6f1e0c1a-0000-4000-8000-0000000000c1',
  flow_name: 'Welcome flow',
  publish_status: 'failed',
  attempts: 5,
  last_error: 'x'.repeat(DEPLOYMENT_ERROR_MAX_CHARS + 20),
  queued_at: new Date('2026-10-19T10:00:00Z'),
  processed_at: null,
  stalled: false,
};

describe('toPublishRow', () => {
  it('maps a failed publish and cuts its error', () => {
    const row = toPublishRow(publish);
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(5);
    expect(row.queuedAt).toBe('2026-10-19T10:00:00.000Z');
    expect(row.processedAt).toBeNull();
    expect(row.lastError).toHaveLength(DEPLOYMENT_ERROR_MAX_CHARS);
  });

  it('keeps a queued publish with no error as null', () => {
    const row = toPublishRow({
      ...publish,
      publish_status: 'queued',
      attempts: 0,
      last_error: null,
    });
    expect(row.status).toBe('queued');
    expect(row.lastError).toBeNull();
  });
});

describe('toPublishCounts', () => {
  it('turns database counts into numbers and treats missing ones as zero', () => {
    expect(toPublishCounts({ queued: '3', done: 10 })).toEqual({
      running: 0,
      queued: 3,
      failed: 0,
      done: 10,
      stalled: 0,
    });
  });
});

/** A product release attempt as platform_releases returns it. */
const attempt = {
  attempt: '11111111-2222-4333-8444-555555555555',
  tag: '29f32b7b6',
  state: 'releasing',
  step: 'schema',
  error: null,
  changes: [
    { pr: 830, title: 'feat(flows): the featured flow tile names its bot', author: 'Akshay' },
  ],
  started_at: new Date('2026-10-19T11:00:00Z'),
  updated_at: new Date('2026-10-19T11:02:00Z'),
  finished_at: null,
  stalled: false,
};

describe('toReleaseRow', () => {
  it('maps an attempt in progress and keeps its step', () => {
    const row = toReleaseRow(attempt);
    expect(row).toEqual({
      id: attempt.attempt,
      tag: '29f32b7b6',
      state: 'releasing',
      step: 'schema',
      error: null,
      changes: [
        { pr: 830, title: 'feat(flows): the featured flow tile names its bot', author: 'Akshay' },
      ],
      startedAt: '2026-10-19T11:00:00.000Z',
      updatedAt: '2026-10-19T11:02:00.000Z',
      finishedAt: null,
      stalled: false,
    });
  });

  it('has no changes for a release recorded before they were kept, and drops a malformed entry', () => {
    expect(toReleaseRow({ ...attempt, changes: null }).changes).toEqual([]);
    const row = toReleaseRow({
      ...attempt,
      changes: [
        { pr: null, title: 'fix: a commit with no PR', author: 'Lakshya' },
        { title: 5 },
        'x',
      ],
    });
    expect(row.changes).toEqual([
      { pr: null, title: 'fix: a commit with no PR', author: 'Lakshya' },
    ]);
  });

  it('cuts a long error and rejects a state the contract does not know', () => {
    const row = toReleaseRow({ ...attempt, state: 'failed', error: 'x'.repeat(900) });
    expect(row.error).toHaveLength(DEPLOYMENT_ERROR_MAX_CHARS);
    expect(() => toReleaseRow({ ...attempt, state: 'queued' })).toThrow();
  });
});

describe('toReleasesResponse', () => {
  it('reports the live tag and whether an attempt is in progress', () => {
    const res = toReleasesResponse('2026-10-19T11:05:00.000Z', {
      rows: [attempt],
      live: { tag: '701ca2c1a', finished_at: new Date('2026-10-19T10:30:00Z') },
    });
    expect(res.live).toEqual({ tag: '701ca2c1a', finishedAt: '2026-10-19T10:30:00.000Z' });
    expect(res.inProgress).toBe(true);
    expect(res.rows).toHaveLength(1);
  });

  it('has no live tag and nothing in progress before the first release', () => {
    const res = toReleasesResponse('2026-10-19T11:05:00.000Z', {
      rows: [{ ...attempt, state: 'ok', finished_at: new Date('2026-10-19T11:04:00Z') }],
      live: null,
    });
    expect(res.live).toBeNull();
    expect(res.inProgress).toBe(false);
  });
});
