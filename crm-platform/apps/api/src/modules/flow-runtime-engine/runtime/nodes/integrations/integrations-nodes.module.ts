import { Module } from '@nestjs/common';
import { IntegrationNodes } from './integrations-nodes';

/** Imports the domains this node group calls (their public modules only); never the flow runtime module (it imports this one). */
@Module({ providers: [IntegrationNodes], exports: [IntegrationNodes] })
export class IntegrationNodesModule {}
