/**
 * Public surface of the segments domain. Other domains import from here, never from the folders below.
 * The Contact Hub reads the list of segments for its "Select Segment" dropdown and creates one from the active filters.
 */
export { invalidateSegments, segmentFromFilters, useSegments } from './api/segments';
export { ROUTES as SEGMENT_ROUTES, cleanSegmentParam } from './lib/url';
export type { Segment } from './api/schemas';
export { AdvancedFilter, appliedConditionCount } from './components/advanced-filter';
export { usePeople } from './api/lookups';
