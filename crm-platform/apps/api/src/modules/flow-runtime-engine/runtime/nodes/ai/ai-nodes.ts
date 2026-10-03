import { Injectable } from '@nestjs/common';
import type { NodeContext, NodeExecutor, NodeResult } from '../../types';

/** Node group `ai`: see the wiring map for which TW-FLR rows it covers. Types not built yet keep the engine's "no executor" pass-through. */
@Injectable()
export class AiNodes implements NodeExecutor {
  readonly types: readonly string[] = [];

  async execute(_ctx: NodeContext): Promise<NodeResult> {
    return { kind: 'advance', port: 1 };
  }
}
