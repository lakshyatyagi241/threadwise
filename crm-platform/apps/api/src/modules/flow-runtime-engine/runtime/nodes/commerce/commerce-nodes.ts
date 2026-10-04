import { Injectable } from '@nestjs/common';
import type {
  CustomDecision,
  InboundReply,
  NodeContext,
  NodeExecutor,
  NodeResult,
} from '../../types';
import { BookNode } from './book-node';
import { FormNode } from './form-node';
import { ShopNode } from './shop-node';
import { TemplateNode } from './template-node';

/**
 * Node group `commerce` (TW-FLR-026, 040, 041, 043): Template, Book appointment, Commerce shop and WhatsApp Form. One executor per
 * node type lives in its own file; this class is the one the engine's token holds and hands each type to its executor.
 */
@Injectable()
export class CommerceNodes implements NodeExecutor {
  private readonly byType: Map<string, NodeExecutor>;
  readonly types: readonly string[];

  constructor(template: TemplateNode, book: BookNode, shop: ShopNode, form: FormNode) {
    this.byType = new Map<string, NodeExecutor>([
      ['Template', { types: ['Template'], execute: (c) => template.execute(c) }],
      [
        'BookAppointment',
        {
          types: ['BookAppointment'],
          execute: (c) => book.execute(c),
          onReply: (c, r) => book.onReply(c, r),
        },
      ],
      [
        'CommerceShop',
        {
          types: ['CommerceShop'],
          execute: (c) => shop.execute(c),
          onReply: (c, r) => shop.onReply(c, r),
        },
      ],
      [
        'WaForm',
        {
          types: ['WaForm'],
          execute: (c) => form.execute(c),
          onReply: (c, r) => form.onReply(c, r),
        },
      ],
    ]);
    this.types = [...this.byType.keys()];
  }

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const executor = this.byType.get(ctx.node.type);
    return executor ? executor.execute(ctx) : { kind: 'advance', port: 1 };
  }

  async onReply(ctx: NodeContext, reply: InboundReply): Promise<CustomDecision> {
    const handler = ctx.run.wait?.handler;
    const executor = handler ? this.byType.get(handler) : undefined;
    return executor?.onReply ? executor.onReply(ctx, reply) : { action: 'ignore' };
  }
}
