import { Module } from '@nestjs/common';
import { CommerceNodes } from './commerce-nodes';

/** Imports the domains this node group calls (their public modules only); never the flow runtime module (it imports this one). */
@Module({ providers: [CommerceNodes], exports: [CommerceNodes] })
export class CommerceNodesModule {}
