/**
 * Public surface of the Marketplace domain (MKT). Other modules import from here, never from the files behind it.
 *
 *   MarketplaceModule         the HTTP side: catalogue, installations, requests, operator API, the public delivery address
 *   MarketplaceWorkerModule   the pull connectors' schedule and job (worker process only)
 */
export { MarketplaceModule } from './marketplace.module';
export { MarketplaceWorkerModule } from './marketplace-worker.module';
