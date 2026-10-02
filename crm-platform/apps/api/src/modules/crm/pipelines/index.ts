/** Public surface of the pipelines module (pipelines, stages, lost reasons). */
export { PipelinesService } from './pipelines.service';
export { PipelinesRepository } from './pipelines.repository';
export { LostReasonsService } from './lost-reasons.service';
export { toPipelineResponse, toStageResponse } from './pipelines.mapper';
export type { PipelineRow, StageRow } from './pipelines.repository';
