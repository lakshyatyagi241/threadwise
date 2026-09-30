import { Module } from '@nestjs/common';
import { PermissionsController } from './permissions/permissions.controller';
import { RolesController } from './roles/roles.controller';
import { RolesRepository } from './roles/roles.repository';
import { RolesService } from './roles/roles.service';
import { UsersController } from './users/users.controller';
import { UsersRepository } from './users/users.repository';
import { UsersService } from './users/users.service';

/**
 * Platform administration: staff users, roles/grants, and the permission
 * registry. Settings > Users & Permissions on the frontend.
 */
@Module({
  controllers: [UsersController, RolesController, PermissionsController],
  providers: [UsersService, UsersRepository, RolesService, RolesRepository],
  exports: [UsersService, RolesService],
})
export class AdminModule {}
