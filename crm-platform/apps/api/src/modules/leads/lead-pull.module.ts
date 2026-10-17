import { Module } from '@nestjs/common';
import { LEAD_PULL_REGISTRY } from './lead-pull.port';
import { LeadPullRegistry } from './lead-pull.registry';

/**
 * The registry of pull providers, once per process. Imported by the HTTP side (which asks what a source can do) and the worker side
 * (which runs the pull); the domains that own pull-capable sources find the registry by its token and register themselves.
 */
@Module({
  providers: [LeadPullRegistry, { provide: LEAD_PULL_REGISTRY, useExisting: LeadPullRegistry }],
  exports: [LeadPullRegistry, LEAD_PULL_REGISTRY],
})
export class LeadPullModule {}
