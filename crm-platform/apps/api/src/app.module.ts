import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AppConfigModule } from './config/config.module';
import type { Env } from './config/env.schema';
import { CryptoService } from './common/crypto/crypto.service';
import { ProblemExceptionFilter } from './common/filters/problem-exception.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { RequestContextStore } from './common/context/request-context';
import { DbModule } from './infra/db/db.module';
import { RedisModule } from './infra/redis/redis.module';
import { QueueModule } from './infra/queue/queue.module';
import { ProvidersModule } from './infra/providers/providers.module';
import { KernelModule } from './kernel/kernel.module';
import { AuthModule } from './modules/auth/auth.module';
import { SendGuardModule } from './modules/auth/security/send-guard.module';
import { AccountGateGuard } from './modules/auth/guards/account-gate.guard';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { AdminModule } from './modules/admin';
import { BspBillingEngineModule } from './modules/bsp-billing-engine';
import { BroadcastsModule } from './modules/broadcasts';
import { AiKeysUsageAdminModule } from './modules/ai-keys-usage-admin';
import { CrmModule } from './modules/crm';
import { LocalizationTranslationModule } from './modules/localization-translation';
import { PlatformSupportDeskModule } from './modules/platform-support-desk';
import { DashboardsAnalyticsChartsModule } from './modules/dashboards-analytics-charts';
import { PlansModule } from './modules/plans-subscriptions-trials/plans.module';
import { PlatformSettingsModule } from './modules/platform-settings-branding-storage';
import { InstallUpdateLicensingModule } from './modules/install-update-licensing';
import { AddonsExtensionRegistryModule } from './modules/addons-extension-registry';
import { CmsModule } from './modules/marketing-site-cms';
import { AdminConsoleShellModule } from './modules/admin-console-shell';
import { PlatformPaymentGatewaysModule } from './modules/platform-payment-gateways';
import { PartnerModule } from './modules/partner/partner.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { RealtimeModule } from './realtime/realtime.module';
import { HealthModule } from './health/health.module';

/**
 * The HTTP application.
 *
 * Order matters in two places:
 *   - JwtAuthGuard runs before PermissionsGuard, because you cannot check a
 *     user's grants before you know who they are.
 *   - RequestContextMiddleware runs before both, so guards write into a context
 *     that already exists.
 *
 * Background work is deliberately absent — see worker.ts.
 */
@Module({
  imports: [
    AppConfigModule,

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
              : undefined,
          genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
          // Every log line carries the tenant and actor, so a production
          // question ("what did org 42 do at 14:03") is a filter, not a grep.
          customProps: () => {
            const ctx = RequestContextStore.peek();
            return ctx
              ? {
                  requestId: ctx.requestId,
                  orgId: ctx.orgId || undefined,
                  actorType: ctx.actorType,
                  actorId: ctx.actorId ?? undefined,
                }
              : {};
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-api-key"]',
              'req.body.password',
              'req.body.credentials',
              'res.headers["set-cookie"]',
            ],
            remove: true,
          },
          autoLogging: {
            // Health probes fire every few seconds; logging them buries
            // everything that matters.
            ignore: (req) => req.url === '/health' || req.url === '/ready',
          },
        },
      }),
    }),

    // Infrastructure
    DbModule,
    RedisModule,
    QueueModule,
    ProvidersModule,

    // Platform
    KernelModule,
    AuthModule,
    PlansModule,
    PlatformSettingsModule,
    LocalizationTranslationModule,
    InstallUpdateLicensingModule,
    AddonsExtensionRegistryModule,
    AiKeysUsageAdminModule,
    CmsModule,
    AdminConsoleShellModule,
    PlatformPaymentGatewaysModule,
    BspBillingEngineModule,
    SendGuardModule,
    RealtimeModule,
    HealthModule,

    // Apps
    AdminModule,
    CrmModule,
    DashboardsAnalyticsChartsModule,
    BroadcastsModule,
    PartnerModule,
    PublicApiModule,
    PlatformSupportDeskModule,
    // InboxModule, BroadcastModule, BillingModule, ExamsModule — see each
    // module's README for the intended shape.
  ],
  providers: [
    CryptoService,
    { provide: APP_FILTER, useClass: ProblemExceptionFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // After authentication, before permissions: a gated account (suspended,
    // unverified under 'block', MFA or password change required) is refused
    // here with a code the web app maps to the right lock screen.
    { provide: APP_GUARD, useClass: AccountGateGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [CryptoService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
