import { Module } from '@nestjs/common';
import { WabaIngestProcessor } from './waba-ingest.processor';
import { WabaModule } from './waba.module';

/** The WhatsApp webhook consumer. Imported ONLY by WorkersModule: the HTTP app answers Meta, the worker does the work. */
@Module({ imports: [WabaModule], providers: [WabaIngestProcessor] })
export class WabaWorkerModule {}
