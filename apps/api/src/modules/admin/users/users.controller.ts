import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  type CreateUserInput,
  type ListUsersQuery,
  type UpdateUserInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

@ApiTags('users')
@ActorKinds('user')
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: "The caller's own profile" })
  async me() {
    return this.users.getSelf();
  }

  @Get()
  @RequirePermission('admin.user.manage')
  @ApiOperation({ summary: 'List staff users (cursor paginated)' })
  async list(@Query(zodPipe(listUsersQuerySchema)) query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Get(':id')
  @RequirePermission('admin.user.manage')
  @ApiOperation({ summary: 'Get one staff user by uuid' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getByUuid(id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('admin.user.manage')
  @ApiOperation({ summary: 'Create a staff user' })
  async create(@Body(zodPipe(createUserSchema)) body: CreateUserInput) {
    return this.users.create(body);
  }

  @Patch(':id')
  @RequirePermission('admin.user.manage')
  @ApiOperation({
    summary: 'Update a staff user',
    description:
      'Requires the rowVersion you read. A mismatch returns 409 ROW_VERSION_CONFLICT. ' +
      'roleIds, when present, fully replaces the role set.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateUserSchema)) body: UpdateUserInput,
  ) {
    return this.users.update(id, body);
  }
}
