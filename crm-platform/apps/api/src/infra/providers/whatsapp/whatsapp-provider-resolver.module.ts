import { Global, Module, type DynamicModule, type ModuleMetadata, type Provider } from '@nestjs/common';
import { StaticMetaDirectResolver, WHATSAPP_PROVIDER_RESOLVER } from './whatsapp-provider.resolver';

type Binding = { useExisting: NonNullable<unknown> } | { useClass: new (...args: never[]) => unknown } | { useValue: unknown };

export interface WhatsappProviderResolverOptions {
  /** Modules that export what the binding needs (the provider registry module). */
  imports?: ModuleMetadata['imports'];
  /** The resolver. Default: `StaticMetaDirectResolver` (Meta directly, the channel's own token). */
  resolver?: Binding;
}

/**
 * Binds `WHATSAPP_PROVIDER_RESOLVER` for the whole process (global, so the infra adapter and the webhook door both reach it without
 * importing a domain module: `infra` may not). The app passes the registry-backed resolver here; with no options the direct-to-Meta
 * default is bound, so nothing depends on the registry being there.
 */
@Global()
@Module({})
export class WhatsappProviderResolverModule {
  static register(options: WhatsappProviderResolverOptions = {}): DynamicModule {
    const provider: Provider = {
      provide: WHATSAPP_PROVIDER_RESOLVER,
      ...(options.resolver ?? { useClass: StaticMetaDirectResolver }),
    } as Provider;
    return {
      module: WhatsappProviderResolverModule,
      global: true,
      imports: options.imports ?? [],
      providers: [provider],
      exports: [WHATSAPP_PROVIDER_RESOLVER],
    };
  }
}
