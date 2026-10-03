import { Module } from '@nestjs/common';
import { ActionNodes } from './actions-nodes';

/** Imports the domains this node group calls (their public modules only); never the flow runtime module (it imports this one). */
@Module({ providers: [ActionNodes], exports: [ActionNodes] })
export class ActionNodesModule {}
