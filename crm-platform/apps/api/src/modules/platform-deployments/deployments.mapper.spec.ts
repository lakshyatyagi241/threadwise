import { describe, expect, it } from 'vitest';
import { DEPLOYMENT_ERROR_MAX_CHARS } from '@crm/contracts';
import {
  toDeploymentCounts,
  toDeploymentRow,
  toPublishCounts,
  toPublishRow,
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
