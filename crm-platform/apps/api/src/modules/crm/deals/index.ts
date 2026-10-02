/** Public surface of the deals module (the board, the stage-change engine, reports). */
export { DealsService } from './deals.service';
export { DealsRepository } from './deals.repository';
export { DealEngine } from './deal-engine.service';
export { DealBoardService } from './deal-board.service';
export { DealReportsService } from './deal-reports.service';
export { DealActivitiesService } from './deal-activities.service';
export { toDealResponse } from './deals.mapper';
export type { DealRow } from './deals.repository';
