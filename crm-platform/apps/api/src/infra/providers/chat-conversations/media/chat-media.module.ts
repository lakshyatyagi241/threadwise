import type { DynamicModule, ModuleMetadata, Provider } from '@nestjs/common';
import { CryptoService } from '../../../../common/crypto/crypto.service';
import { ChatMediaStore, LOCAL_DISK_MEDIA_STORE } from './chat-media.store';
import { LocalDiskMediaStore } from './local-disk-media.store';
import { MediaTokenService } from './media-token.service';
import { ChatMediaController } from './media.controller';
import { chatMediaConfig } from './media.config';
import { MEDIA_ACCESS_POLICY, MEDIA_OBJECT_GATEWAY, MEDIA_UPLOAD_VALIDATOR } from './media.ports';

/** How a port is bound: to an existing provider (`useExisting`), a class, or a value. */
type Binding =
  | { useExisting: NonNullable<unknown> }
  | { useClass: new (...args: never[]) => unknown }
  | { useValue: unknown };

export interface ChatMediaModuleOptions {
  /** Modules that export what the bindings need (the settings module for `MediaStorageService`). */
  imports?: ModuleMetadata['imports'];
  /** `MediaStorageService`. */
  objectGateway: Binding;
  /** `UploadPolicyService`. */
  uploadValidator: Binding;
  /** The domain's rule for who may read a key (optional; the workspace check always applies). */
  accessPolicy?: Binding;
}

/**
 * The chat media door, as a global module: `ChatMediaStore` (store, open, link) and `MediaTokenService` are injectable anywhere,
 * and the HTTP app also gets the media route. `infra` may not import domain modules, so the app passes in the three services it
 * needs, bound to ports (see `media.ports.ts`).
 */
export class ChatMediaModule {
  static register(options: ChatMediaModuleOptions): DynamicModule {
    const providers: Provider[] = [
      CryptoService,
      MediaTokenService,
      ChatMediaStore,
      {
        provide: LOCAL_DISK_MEDIA_STORE,
        useFactory: () => new LocalDiskMediaStore(chatMediaConfig().localDir),
      },
      { provide: MEDIA_OBJECT_GATEWAY, ...options.objectGateway },
      { provide: MEDIA_UPLOAD_VALIDATOR, ...options.uploadValidator },
      ...(options.accessPolicy
        ? [{ provide: MEDIA_ACCESS_POLICY, ...options.accessPolicy } as Provider]
        : []),
    ];
    return {
      module: ChatMediaModule,
      global: true,
      imports: options.imports ?? [],
      controllers: [ChatMediaController],
      providers,
      exports: [ChatMediaStore, MediaTokenService],
    };
  }
}
