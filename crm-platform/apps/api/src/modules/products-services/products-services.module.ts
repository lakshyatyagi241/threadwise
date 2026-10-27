import { Module } from '@nestjs/common';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { ProductsServicesController } from './products-services.controller';
import { ProductsServicesRepository } from './products-services.repository';
import { ProductsServicesService } from './products-services.service';

/**
 * Products and services: the price list add-on. A paid Marketplace app, so every route needs the plan feature `products_services`
 * (granted only by owning the app).
 */
@Module({
  imports: [PlansCoreModule],
  controllers: [ProductsServicesController],
  providers: [ProductsServicesRepository, ProductsServicesService],
  exports: [ProductsServicesService],
})
export class ProductsServicesModule {}
