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
export { STREAM_POLICIES, type StreamPolicy } from './retention-policies';
