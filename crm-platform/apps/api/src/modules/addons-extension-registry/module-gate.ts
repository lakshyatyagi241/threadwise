import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { ModuleRegistryService } from './module-registry.service';

export const REQUIRES_MODULE_KEY = 'add:requires-module';

/**
 * Marks a controller or route as belonging to an installable module (WD-ADD-011). With ModuleGateGuard it answers 404
 * the moment the module is switched off, and serves again when it is switched back on, with no restart: the
 * registry's enabled flag is the only thing consulted.
 *
 *   @RequiresModule('instagram')
 *   @UseGuards(ModuleGateGuard)
 *   @Controller(...)
 */
export const RequiresModule = (slug: string) => SetMetadata(REQUIRES_MODULE_KEY, slug);

@Injectable()
export class ModuleGateGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly registry: ModuleRegistryService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const slug = this.reflector.getAllAndOverride<string | undefined>(REQUIRES_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!slug) return true;
    if (await this.registry.isEnabled(slug)) return true;
    throw new AppError(ERROR_CODES.ADD_MODULE_DISABLED, 'Not found', HttpStatus.NOT_FOUND);
  }
}
