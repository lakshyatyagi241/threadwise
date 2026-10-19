/**
 * The runner agent of the Waboo migration panel. Waboo's database only answers over the Geta VPN, so the pipeline runs on a small agent
 * on a VPN-connected machine: it asks the API for the job of a RUNNING run, starts the pipeline, and reports the pipeline's stdout lines
 * back. The API validates and scrubs every line the same way it would if it had spawned the pipeline itself (parseLine), so the agent is
 * never trusted with the shape of an event. The jobs are addressed by the run's uuid. No secret travels in any body: the agent proves
 * itself with a bearer token that lives only in its own environment and in the API's.
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { WMIG_CLIENT_RE, WMIG_DB_RE, WMIG_MODES } from './constants';

/** Agent names are short labels ("vedant-laptop"), shown in the panel. */
export const WMIG_RUNNER_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
export const wabooMigrationRunnerNameSchema = z.string().regex(WMIG_RUNNER_NAME_RE);

/** The panel calls an agent online when it has been heard from this recently. */
export const WMIG_RUNNER_ONLINE_SECONDS = 60;
/** The most stdout lines one report may carry, and the longest one (a real event is a few hundred bytes; the agent also keeps a report under 64 KB). */
export const WMIG_RUNNER_MAX_LINES = 50;
export const WMIG_RUNNER_MAX_LINE = 8 * 1024;

export const wabooMigrationRunnerClaimSchema = z.object({ runner: wabooMigrationRunnerNameSchema });
export type WabooMigrationRunnerClaim = z.infer<typeof wabooMigrationRunnerClaimSchema>;

/** What the agent starts the pipeline with: the three values of the run and its testing switch (no WhatsApp number). */
export const wabooMigrationRunnerJobSchema = z.object({
  runId: uuidSchema,
  sourceClient: z.string().regex(WMIG_CLIENT_RE),
  sourceDb: z.string().regex(WMIG_DB_RE),
  mode: z.enum(WMIG_MODES),
  skipWhatsapp: z.boolean().default(false),
});
export type WabooMigrationRunnerJob = z.infer<typeof wabooMigrationRunnerJobSchema>;

export const wabooMigrationRunnerClaimResponseSchema = z.object({
  job: wabooMigrationRunnerJobSchema.nullable(),
});

/** Raw stdout lines of the pipeline (the API parses them) and the tail of its stderr; also the heartbeat when both are empty. */
export const wabooMigrationRunnerReportSchema = z.object({
  runner: wabooMigrationRunnerNameSchema,
  lines: z.array(z.string().max(WMIG_RUNNER_MAX_LINE)).max(WMIG_RUNNER_MAX_LINES).default([]),
  stderrTail: z.string().max(8192).default(''),
});
export type WabooMigrationRunnerReport = z.infer<typeof wabooMigrationRunnerReportSchema>;

/** `cancel` true = stop the pipeline now: the worker gave up on this job. */
export const wabooMigrationRunnerReportResponseSchema = z.object({ cancel: z.boolean() });

export const wabooMigrationRunnerFinishSchema = z.object({
  runner: wabooMigrationRunnerNameSchema,
  exitCode: z.number().int().min(-1).max(255).nullable(),
  timedOut: z.boolean(),
  stderrTail: z.string().max(8192).default(''),
});
export type WabooMigrationRunnerFinish = z.infer<typeof wabooMigrationRunnerFinishSchema>;

/** For the panel: is an agent connected? */
export const wabooMigrationRunnerStatusSchema = z.object({
  /** false = the API is not set to use an agent (runs start the pipeline in the worker itself) */
  mode: z.enum(['remote', 'local']),
  online: z.boolean(),
  name: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
});
export type WabooMigrationRunnerStatus = z.infer<typeof wabooMigrationRunnerStatusSchema>;
