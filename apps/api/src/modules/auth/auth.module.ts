import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';

/**
 * Authentication and authorisation.
 *
 * Global because the two guards are registered app-wide in app.module.ts and
 * Nest needs their dependencies resolvable from the root injector.
 *
 * Secrets are passed per-sign/verify call rather than configured once here —
 * access and refresh tokens use different keys (see TokenService).
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtAuthGuard, PermissionsGuard],
  exports: [AuthService, TokenService, JwtAuthGuard, PermissionsGuard],
})
export class AuthModule {}
