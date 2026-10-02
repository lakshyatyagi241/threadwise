import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { CHANNEL_ADAPTERS, type ChannelAdapter } from '../../infra/providers/chat-conversations';

/** The adapters bound in this deployment, looked up by channel kind. */
@Injectable()
export class ChannelAdapterRegistry {
  private readonly byKind: Map<string, ChannelAdapter>;

  constructor(@Inject(CHANNEL_ADAPTERS) adapters: ChannelAdapter[]) {
    this.byKind = new Map(adapters.map((a) => [a.kind, a]));
  }

  find(kind: string): ChannelAdapter | undefined {
    return this.byKind.get(kind);
  }

  /** The adapter for `kind`, or a 422 when this deployment has none (the simulator in production, a kind nobody wrote yet). */
  for(kind: string): ChannelAdapter {
    const adapter = this.byKind.get(kind);
    if (!adapter) {
      throw new AppError(
        ERROR_CODES.CHANNEL_KIND_UNAVAILABLE,
        `Channel kind "${kind}" is not available`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return adapter;
  }

  kinds(): string[] {
    return [...this.byKind.keys()];
  }
}
