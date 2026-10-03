import {
  applyDecorators,
  Injectable,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PublicRateLimiter, type PublicBucket } from './public-rate-limiter';

const BUCKET_KEY = 'store_public_bucket';

/**
 * Counts the call against the route's per-address limit before the body is validated, like Laravel's `throttle` middleware does:
 * a malformed request costs a slot too, so probing with junk cannot run past the limit.
 */
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: PublicRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bucket = this.reflector.get<PublicBucket | undefined>(BUCKET_KEY, context.getHandler());
    if (!bucket) return true;
    const req = context.switchToHttp().getRequest<{ ip?: string }>();
    await this.limiter.hit(bucket, req.ip ?? '');
    return true;
  }
}

export const PublicLimit = (bucket: PublicBucket) =>
  applyDecorators(SetMetadata(BUCKET_KEY, bucket), UseGuards(PublicRateLimitGuard));
