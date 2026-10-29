import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { flbTriggerConfig, type FlbGoogleSheetConfig } from '@crm/contracts';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  GOOGLE_WORKSPACE,
  GoogleAccountError,
  type GoogleWorkspacePort,
} from '../../../infra/providers/flow-runtime-engine/google-workspace.port';
import { liveTrigger } from '../runtime/live-graph';
import { personOf, rowVariables, variableName, type ExternalPerson } from './external-payload';
import { FlowTriggerService } from './trigger.service';

/** Rows one look starts the flow for; a busier sheet catches up over the next looks (the bookmark moves by what was taken). */
export const SHEET_ROWS_PER_POLL = 100;

type Rows = { rows: Array<Record<string, unknown>> };

interface SheetFlow {
  orgId: number;
  flowId: number;
  config: FlbGoogleSheetConfig;
  /** Null until the flow's first look at the sheet. */
  cursor: { sheetKey: string; lastRow: number; lastPolledAt: Date } | null;
}

/** What one look at one flow did, for tests and the log. */
export type SheetPollOutcome = 'baseline' | 'idle' | 'started' | 'error' | 'skipped';

/**
 * The Google Sheet trigger (option "polling"): a new row in a sheet starts a flow. Google has no push for a cell change, so once a
 * minute every live flow with that trigger is looked at when its own interval (1 to 5 minutes) is due. The workspace's connected
 * Google account reads the tab (the `sheets` capability, the same grant the Sheets nodes use).
 *
 *  - The bookmark is `flow_sheet_cursor.last_row`: how many rows (header included) the flow has already seen. A row is new when it lies
 *    beyond it. The bookmark is advanced with a compare-and-set BEFORE the flow is started, so two workers, or a restart, never run a
 *    row twice (the price: a crash between the two skips that row, like the schedule sweeper).
 *  - A flow's first look only records the sheet's size and starts nothing: turning the trigger on never runs for the rows already there.
 *    The bookmark is deleted whenever the flow stops being live, so turning it off and on again starts from the sheet as it is then.
 *    A different sheet or tab (or one that lost rows) is a new baseline too.
 *  - A row names its person by the phone column (else the email column); with none set the headers `phone`, `mobile`, `whatsapp` and
 *    `email` are tried. The contact is found or made, and each cell becomes a run variable named after its header. A row with nobody
 *    in it is passed over.
 *  - A Google account that is not connected or lacks the permission is not an error here: the look is recorded (the code is kept on
 *    the bookmark) and tried again at the next interval.
 *
 * Worker only. Runs privileged to find flows across workspaces; every start then runs in that workspace.
 */
@Injectable()
export class SheetTriggerSweeper {
  private readonly logger = new Logger(SheetTriggerSweeper.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly triggers: FlowTriggerService,
    @Inject(GOOGLE_WORKSPACE) private readonly google: GoogleWorkspacePort,
  ) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tickOnce();
    } catch (err) {
      this.logger.error({ err }, '[FLR] sheet trigger sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** Public for tests. Returns each flow's outcome. */
  async tickOnce(now: Date = new Date()): Promise<Map<number, SheetPollOutcome>> {
    await this.forgetStopped();
    const out = new Map<number, SheetPollOutcome>();
    for (const flow of await this.liveSheetFlows()) {
      try {
        out.set(flow.flowId, await this.poll(flow, now));
      } catch (err) {
        out.set(flow.flowId, 'error');
        this.logger.warn(
          { orgId: flow.orgId, flowId: flow.flowId, err: (err as Error).message },
          '[FLR] sheet trigger failed',
        );
      }
    }
    return out;
  }

  /** The bookmark of a flow that is no longer live (unpublished, paused, another trigger, deleted trigger) goes, so re-enabling starts fresh. */
  private async forgetStopped(): Promise<void> {
    await this.db.privileged((tx) =>
      tx.execute(sql`
        DELETE FROM flow_sheet_cursor c
         WHERE NOT EXISTS (
           SELECT 1 FROM flows f
            WHERE f.org_id = c.org_id AND f.id = c.flow_id AND f.is_published AND f.is_active
              AND ${liveTrigger('trigger_kind', 'f')} = 'google_sheet')`),
    );
  }

  private async liveSheetFlows(): Promise<SheetFlow[]> {
    const res = (await this.db.privileged((tx) =>
      tx.execute(sql`
        SELECT f.org_id, f.id, ${liveTrigger('trigger_config', 'f')} AS trigger_config,
               c.sheet_key, c.last_row, c.last_polled_at
          FROM flows f
          LEFT JOIN flow_sheet_cursor c ON c.org_id = f.org_id AND c.flow_id = f.id
         WHERE f.is_published AND f.is_active AND ${liveTrigger('trigger_kind', 'f')} = 'google_sheet'
         ORDER BY f.id`),
    )) as unknown as Rows;
    const flows: SheetFlow[] = [];
    for (const r of res.rows) {
      const raw =
        r.trigger_config !== null && typeof r.trigger_config === 'object'
          ? (r.trigger_config as Record<string, unknown>)
          : {};
      const config = flbTriggerConfig('google_sheet', raw) as FlbGoogleSheetConfig | null;
      if (!config || config.sheetId === '') continue;
      flows.push({
        orgId: Number(r.org_id),
        flowId: Number(r.id),
        config,
        cursor:
          r.sheet_key === null || r.sheet_key === undefined
            ? null
            : {
                sheetKey: String(r.sheet_key),
                lastRow: Number(r.last_row),
                lastPolledAt: new Date(String(r.last_polled_at)),
              },
      });
    }
    return flows;
  }

  private async poll(flow: SheetFlow, now: Date): Promise<SheetPollOutcome> {
    const { orgId, flowId, config, cursor } = flow;
    // Five seconds of slack, so a look that ran a moment early on its last turn is not pushed a whole tick later.
    if (
      cursor &&
      now.getTime() - cursor.lastPolledAt.getTime() < config.intervalMinutes * 60_000 - 5_000
    ) {
      return 'skipped';
    }
    const sheetKey = `${config.sheetId}|${config.tabName}`;
    let grid: string[][];
    try {
      grid = await this.google.readSheetGrid(orgId, {
        sheetId: config.sheetId,
        tabName: config.tabName,
      });
    } catch (err) {
      const code = err instanceof GoogleAccountError ? err.code : 'GOOGLE_UNAVAILABLE';
      if (!(err instanceof GoogleAccountError)) {
        this.logger.warn({ orgId, flowId, err: (err as Error).message }, '[FLR] sheet read failed');
      }
      if (cursor) await this.record(orgId, flowId, code);
      return 'error';
    }

    // First look, or a different sheet: remember how big it is and start nothing.
    if (!cursor || cursor.sheetKey !== sheetKey) {
      await this.baseline(orgId, flowId, sheetKey, grid.length, cursor?.sheetKey ?? null);
      return 'baseline';
    }
    // The sheet lost rows: nothing is new; the bookmark follows it down so the next added row is seen.
    if (grid.length < cursor.lastRow) {
      await this.move(orgId, flowId, cursor.lastRow, grid.length);
      return 'baseline';
    }
    // Row 1 is the header and never a row.
    const from = Math.max(cursor.lastRow, 1);
    const fresh = grid.slice(from, from + SHEET_ROWS_PER_POLL);
    if (fresh.length === 0) {
      await this.record(orgId, flowId, null);
      return 'idle';
    }
    const to = from + fresh.length;
    if (!(await this.move(orgId, flowId, cursor.lastRow, to))) return 'skipped';

    const headers = grid[0] ?? [];
    const keyHash = createHash('sha256').update(sheetKey).digest('hex').slice(0, 12);
    let started = 0;
    for (const [i, cells] of fresh.entries()) {
      const rowNumber = from + i + 1;
      const vars = rowVariables(headers, cells, rowNumber);
      const person = this.personOfRow(config, vars);
      if (!person.phone && !person.email) continue;
      const result = await this.triggers.onExternalEvent(
        orgId,
        flowId,
        'sheet_row',
        `sheet:${flowId}:${keyHash}:${rowNumber}`,
        person,
        vars,
      );
      if (result === 'started') started++;
    }
    return started > 0 ? 'started' : 'idle';
  }

  private personOfRow(config: FlbGoogleSheetConfig, vars: Record<string, string>): ExternalPerson {
    const guess = personOf(vars);
    const col = (header: string): string | null =>
      header === '' ? null : vars[variableName(header)]?.trim() || null;
    return {
      phone: config.phoneColumn !== '' ? col(config.phoneColumn) : guess.phone,
      email: config.emailColumn !== '' ? col(config.emailColumn) : guess.email,
      name: config.nameColumn !== '' ? col(config.nameColumn) : guess.name,
    };
  }

  /** Records the sheet's size as what has been seen. A concurrent worker that did it first wins; both wrote the same thing. */
  private async baseline(
    orgId: number,
    flowId: number,
    sheetKey: string,
    size: number,
    previousKey: string | null,
  ): Promise<void> {
    await this.db.privileged((tx) =>
      previousKey === null
        ? tx.execute(sql`
            INSERT INTO flow_sheet_cursor (org_id, flow_id, sheet_key, last_row)
            VALUES (${orgId}, ${flowId}, ${sheetKey}, ${size})
            ON CONFLICT (org_id, flow_id) DO NOTHING`)
        : tx.execute(sql`
            UPDATE flow_sheet_cursor SET sheet_key = ${sheetKey}, last_row = ${size}, last_polled_at = now(), last_error = NULL
             WHERE org_id = ${orgId} AND flow_id = ${flowId} AND sheet_key = ${previousKey}`),
    );
  }

  /** Moves the bookmark from `from` to `to`; false when another worker moved it first (the rows are theirs). */
  private async move(orgId: number, flowId: number, from: number, to: number): Promise<boolean> {
    const res = (await this.db.privileged((tx) =>
      tx.execute(sql`
        UPDATE flow_sheet_cursor SET last_row = ${to}, last_polled_at = now(), last_error = NULL
         WHERE org_id = ${orgId} AND flow_id = ${flowId} AND last_row = ${from} RETURNING flow_id`),
    )) as unknown as Rows;
    return res.rows.length > 0;
  }

  /** A look that found nothing to do: when it was, and the code of the failure, if there was one. */
  private async record(orgId: number, flowId: number, error: string | null): Promise<void> {
    await this.db.privileged((tx) =>
      tx.execute(sql`
        UPDATE flow_sheet_cursor SET last_polled_at = now(), last_error = ${error}
         WHERE org_id = ${orgId} AND flow_id = ${flowId}`),
    );
  }
}
