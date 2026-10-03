/**
 * The unofficial engine's daily cap, shared with campaigns, broadcasts and schedules (WD-FLR-020). The tally lives in Redis under the
 * key the broadcast sender uses, so a number's day is one count however its messages leave. These are the broadcast domain's own
 * `CapTally`, `PacingRuntime` and `DEFAULT_PACING`, re-exported: this domain depends on the shared kit, not on the module around it.
 */
export { CapTally, DEFAULT_PACING, PacingRuntime } from '../broadcasts';
