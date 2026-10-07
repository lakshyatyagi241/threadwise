import { Module } from '@nestjs/common';
import { RolesPermissionsModule } from '../roles-permissions';
import { WorkspaceImpersonationController } from './workspace-impersonation.controller';

/**
 * Operator "Login as owner" (WSP). Its own module so the route can use the platform permission guard (roles-permissions imports
 * auth, so the controller cannot live inside auth) without touching the members and teams module. The service is auth's.
 */
@Module({
  imports: [RolesPermissionsModule],
  controllers: [WorkspaceImpersonationController],
})
export class WorkspaceImpersonationModule {}
