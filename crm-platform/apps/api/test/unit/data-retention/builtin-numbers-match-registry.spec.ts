import { describe, expect, it } from 'vitest';
import {
  API_LIBRARY_LOG_RETENTION_DAYS,
  ASSIGNMENT_RUN_RETENTION_DAYS,
  CALL_RECORDING_RETENTION_DEFAULT_DAYS,
  FLOW_RUN_LOG_RETENTION_DAYS,
  MESSAGE_LOG_HOT_DAYS,
  MESSAGE_LOG_RETENTION_DAYS,
  retentionSpecOf,
  type RetentionItemId,
} from '@crm/contracts';
import { FORM_EVENT_RETENTION_DAYS } from '../../../src/modules/forms-builder/form-retention-sweep.service';
import { SYNC_RUN_RETENTION_DAYS } from '../../../src/modules/leads/lead-retention-sweep.service';
import { FAILURE_RETENTION_DAYS } from '../../../src/modules/webhook-fanout/webhook-forward-retention.service';

/**
 * A sweep falls back to its own built-in number when nothing is saved, and the retention page shows the registry's default for the same
 * item. If the two ever differ the page would show one number while the job used another, so they are pinned together here.
 */
describe('the built-in number of each sweep is the registry default of its item', () => {
  const pairs: Array<[RetentionItemId, number]> = [
    ['assignment_runs', ASSIGNMENT_RUN_RETENTION_DAYS],
    ['form_events', FORM_EVENT_RETENTION_DAYS],
    ['lead_sync_runs', SYNC_RUN_RETENTION_DAYS],
    ['api_library_logs', API_LIBRARY_LOG_RETENTION_DAYS],
    ['flow_run_logs', FLOW_RUN_LOG_RETENTION_DAYS],
    ['webhook_forward_failures', FAILURE_RETENTION_DAYS],
    ['call_recordings', CALL_RECORDING_RETENTION_DEFAULT_DAYS],
    ['message_log', MESSAGE_LOG_HOT_DAYS],
  ];
  it.each(pairs)('%s', (item, builtIn) => {
    expect(retentionSpecOf(item).defaults.liveDays).toBe(builtIn);
  });

  it('message log: archive days are the total retention minus the live days', () => {
    expect(retentionSpecOf('message_log').defaults.archiveDays).toBe(
      MESSAGE_LOG_RETENTION_DAYS - MESSAGE_LOG_HOT_DAYS,
    );
  });
});
