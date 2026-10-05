import { Module } from '@nestjs/common';
import { CatalogProductsModule } from './catalog-products.module';
import { CatalogResyncSweepService, StockHoldSweepService } from './catalog-sweeps.service';

/**
 * The catalog background work: the Meta resync sweep and the expired stock-hold sweep. Imported ONLY by WorkersModule (the
 * worker process): the HTTP app never runs a sweep.
 */
@Module({
  imports: [CatalogProductsModule],
  providers: [CatalogResyncSweepService, StockHoldSweepService],
})
export class CatalogProductsWorkerModule {}
