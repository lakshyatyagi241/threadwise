/**
 * Public surface of the segments domain. Other domains import from here, never from the folders below.
 * The Contact Hub reads the list of segments for its "Select Segment" dropdown and creates one from the active filters.
 */
export { invalidateSegments, segmentFromFilters, useSegments } from './api/segments';
export { ROUTES as SEGMENT_ROUTES, cleanSegmentParam } from './lib/url';
export type { Segment } from './api/schemas';
export { AdvancedFilter, appliedConditionCount } from './components/advanced-filter';
export { RulesEditor, useRulesDraft, type RulesDraft } from './components/rules-editor';
export { usePeople } from './api/lookups';
// The condition editor's pieces, for a list that filters by properties with the segment vocabulary (the Companies list, BL-196).
export { ValueInput } from './components/value-inputs';
export { fromWire, toWire } from './lib/wire';
export { inputKindOf, operatorsForKind, type Operator } from './lib/operators';
export {
  changeField,
  changeOperator,
  conditionsOf,
  emptyRoot,
  newCondition,
  removeNode,
  setValue,
  addCondition,
  valueProblem,
  type Condition,
  type EditorValue,
  type Group,
} from './lib/model';
export type { FieldDef } from './lib/fields';
