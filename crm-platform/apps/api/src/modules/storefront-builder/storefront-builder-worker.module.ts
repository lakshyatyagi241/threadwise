import { Module } from '@nestjs/common';
import { CartRecoverySweepService } from './recovery/cart-recovery-sweep.service';
import { StorefrontBuilderModule } from './storefront-builder.module';

/**
 * The abandoned-cart nudge sweep. Imported ONLY by WorkersModule (the worker process): the HTTP app records a cart, it never
 * sends the nudge.
 */
@Module({
  imports: [StorefrontBuilderModule],
  providers: [CartRecoverySweepService],
})
export class StorefrontBuilderWorkerModule {}
