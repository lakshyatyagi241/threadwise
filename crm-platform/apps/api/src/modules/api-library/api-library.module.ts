import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CrmModule } from '../crm';
import { ApiLibraryController } from './api-library.controller';
import { ApiLibraryRepository } from './api-library.repository';
import { ApiLibraryService } from './api-library.service';
import { ApiLibraryLogsRepository } from './api-library-logs.repository';
import { ApiLibraryLogsService } from './api-library-logs.service';
import { ApiLibraryRunService } from './api-library-run.service';
import { ApiLibraryRunner } from './api-library-runner.service';

/**
 * The API Library: saved HTTP calls, their test runs and run log, and the run door the flow engine's `api_library` node uses
 * (ApiLibraryRunService.runForFlow, exported). Registered in app.module.ts and imported by the flow runtime's integration nodes.
 * The daily log sweep is in ApiLibraryWorkerModule.
 */
@Module({
  imports: [CrmModule],
  controllers: [ApiLibraryController],
  providers: [
    CryptoService,
    ApiLibraryRepository,
    ApiLibraryLogsRepository,
    ApiLibraryRunner,
    ApiLibraryService,
    ApiLibraryLogsService,
    ApiLibraryRunService,
  ],
  exports: [ApiLibraryRunService, ApiLibraryRunner],
})
export class ApiLibraryModule {}
