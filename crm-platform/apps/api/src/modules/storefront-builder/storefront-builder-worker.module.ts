import { Module } from '@nestjs/common';
import { DefaultShopConsumer } from './default-shop.consumer';
import { CartRecoverySweepService } from './recovery/cart-recovery-sweep.service';
import { StorefrontBuilderModule } from './storefront-builder.module';

/**
 * The abandoned-cart nudge sweep and the default-shop consumer (a connected number creates the first shop). Imported ONLY by WorkersModule (the worker process): the HTTP app records a cart, it never
 * sends the nudge.
 */
@Module({
  imports: [StorefrontBuilderModule],
  providers: [CartRecoverySweepService, DefaultShopConsumer],
})
export class StorefrontBuilderWorkerModule {}
