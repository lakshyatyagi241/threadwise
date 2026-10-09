import { Module } from '@nestjs/common';
import { ApiLibraryRetentionService } from './api-library-retention.service';

/** The log retention sweep. Imported ONLY by WorkersModule: the HTTP app does not sweep. */
@Module({ providers: [ApiLibraryRetentionService] })
export class ApiLibraryWorkerModule {}
