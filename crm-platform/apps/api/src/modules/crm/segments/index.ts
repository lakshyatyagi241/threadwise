/**
 * Public surface of segments. Other domains (broadcasts, campaigns) that target a segment call
 * SegmentsService.resolveMembers / countMembers through here; see docs/api/segments.md.
 */
export { SegmentsService, SEGMENT_MODULE } from './segments.service';
export { SegmentsRepository } from './segments.repository';
export { SegmentActionsService } from './segment-actions.service';
export { toSegmentResponse } from './segments.mapper';
export type { SegmentRow } from './segments.repository';
/**
 * The rule engine for a caller that holds rules and no saved segment (the broadcast wizard's audience): compile a tree against the
 * workspace, load what it points at, and count with the same timeout the segment counts use. Same functions the saved segments run on,
 * so a count here and a send there evaluate the same SQL.
 */
export { compileRules, collectRuleRefs } from './segment-compiler';
export type { CompiledRules } from './segment-compiler';
export { loadRuleContext } from './segment-rule-context';
export { countWithTimeout, segmentContactsWhere } from './segment-count';
export type { CountResult } from './segment-count';
