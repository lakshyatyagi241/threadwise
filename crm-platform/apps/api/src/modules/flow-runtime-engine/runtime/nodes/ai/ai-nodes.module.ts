import { Module } from '@nestjs/common';
import { AiNodes } from './ai-nodes';

/** Imports the domains this node group calls (their public modules only); never the flow runtime module (it imports this one). */
@Module({ providers: [AiNodes], exports: [AiNodes] })
export class AiNodesModule {}
