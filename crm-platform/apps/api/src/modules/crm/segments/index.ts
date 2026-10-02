/**
 * Public surface of segments. Other domains (broadcasts, campaigns) that target a segment call
 * SegmentsService.resolveMembers / countMembers through here; see docs/api/segments.md.
 */
export { SegmentsService, SEGMENT_MODULE } from './segments.service';
export { SegmentsRepository } from './segments.repository';
export { SegmentActionsService } from './segment-actions.service';
export { toSegmentResponse } from './segments.mapper';
export type { SegmentRow } from './segments.repository';
