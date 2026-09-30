/**
 * Public surface of the Admin module. Other domain modules that need
 * UsersService/RolesService must import from here, not from
 * `modules/admin/users/...` or `modules/admin/roles/...` directly.
 */
export { AdminModule } from './admin.module';
export { UsersService } from './users';
export { RolesService } from './roles';
