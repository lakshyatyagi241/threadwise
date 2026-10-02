import { Module } from '@nestjs/common';
import { EcomImportProcessor } from './ecom-import.processor';
import { ShopifyWoocommerceModule } from './shopify-woocommerce.module';

/** The store import job. Imported ONLY by WorkersModule: the HTTP app queues jobs but must never run them. */
@Module({
  imports: [ShopifyWoocommerceModule],
  providers: [EcomImportProcessor],
})
export class ShopifyWoocommerceWorkerModule {}
