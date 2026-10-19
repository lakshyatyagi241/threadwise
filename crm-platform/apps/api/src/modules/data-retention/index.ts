/** Public surface of the data-retention module. Other modules import from here, never from the files behind it. */
export { DataRetentionModule } from './data-retention.module';
export { DataRetentionWorkerModule } from './data-retention-worker.module';
export { ArchiveEraser } from './archive-eraser.service';
export { archiveEraseMarker, archiveEraseMarkerOrg } from './archive-keys';
export { ArchiveReader, type ArchivedRow } from './archive-reader.service';
export {
  PartitionArchiver,
  type ArchiveManifest,
  type ArchiveResult,
} from './partition-archiver.service';
export {
  STREAM_POLICIES,
  isPastLiveWindow,
  monthBounds,
  type StreamPolicy,
} from './retention-policies';
export { engineState, type EngineState } from './retention-engine';
export {
  deletePolicy,
  liveStats,
  loadPolicies,
  loadPolicy,
  loadRuns,
  partitionSizes,
  countArchiveDaysOlderThan,
  countOlderThan,
  dbArchiveStats,
  liveDaysFor,
  PREVIEW_COUNT_CAP,
  recordRun,
  savePolicy,
  type RunRecord,
  type StoredPolicy,
  type StoredRun,
} from './retention-store';
export { TABLE_ITEMS, type TableItem } from './table-items';
export { recordSweep } from './sweep-record';
