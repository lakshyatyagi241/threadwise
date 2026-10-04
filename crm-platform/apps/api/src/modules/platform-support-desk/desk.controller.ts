import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  createAgentRequestSchema,
  createPlaybookRequestSchema,
  customersQuerySchema,
  moveCardRequestSchema,
  reportsQuerySchema,
  setAgentActiveRequestSchema,
  setPlaybookActiveRequestSchema,
  slaPolicyInputSchema,
  suppBoardQuerySchema,
  updateSlaPolicyRequestSchema,
  uuidSchema,
  type CreateAgentRequest,
  type CreatePlaybookRequest,
  type CustomersQuery,
  type MoveCardRequest,
  type ReportsQuery,
  type SetAgentActiveRequest,
  type SetPlaybookActiveRequest,
  type SlaPolicyInput,
  type UpdateSlaPolicyRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { AgentsService } from './agents.service';
import { BoardService } from './board.service';
import { CustomersService } from './customers.service';
import { PlaybooksService } from './playbooks.service';
import { ReportsService } from './reports.service';
import { SlaService } from './sla.service';

const id = () => Param('id', zodPipe(uuidSchema));
const WRITE = OperatorRoles('super_admin', 'support');

/**
 * The rest of the operator helpdesk: kanban, agents, SLA board, customers, playbooks and reports (TW-SUPP-015..032).
 * Every operator role reads (auditors included); writes need a super admin or support operator.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/support', version: '2' })
export class DeskController {
  constructor(
    private readonly board: BoardService,
    private readonly agents: AgentsService,
    private readonly sla: SlaService,
    private readonly customers: CustomersService,
    private readonly playbooks: PlaybooksService,
    private readonly reports: ReportsService,
  ) {}

  // --- kanban ---------------------------------------------------------------------------------------------------------------------

  @Get('board')
  @ApiOperation({ summary: 'Team-inbox kanban: four columns of tickets' })
  getBoard(@Query(zodPipe(suppBoardQuerySchema)) q: { mine: boolean }) {
    return this.board.board(q.mine);
  }

  @Post('board/:id/move')
  @WRITE
  @HttpCode(200)
  @ApiOperation({ summary: 'Drag a card to another column (sets the ticket status)' })
  move(@id() uuid: string, @Body(zodPipe(moveCardRequestSchema)) body: MoveCardRequest) {
    return this.board.move(uuid, body);
  }

  // --- agents ---------------------------------------------------------------------------------------------------------------------

  @Get('agents')
  @ApiOperation({ summary: 'Agent roster with live stats, candidates and KPIs' })
  listAgents() {
    return this.agents.list();
  }

  @Post('agents')
  @WRITE
  @ApiOperation({ summary: 'Add an operator to the roster' })
  addAgent(@Body(zodPipe(createAgentRequestSchema)) body: CreateAgentRequest) {
    return this.agents.add(body);
  }

  @Patch('agents/:id')
  @WRITE
  @ApiOperation({ summary: 'Switch an agent on or off' })
  setAgentActive(
    @id() uuid: string,
    @Body(zodPipe(setAgentActiveRequestSchema)) body: SetAgentActiveRequest,
  ) {
    return this.agents.setActive(uuid, body);
  }

  @Delete('agents/:id')
  @WRITE
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an agent from the roster' })
  async removeAgent(@id() uuid: string) {
    await this.agents.remove(uuid);
  }

  // --- SLA ------------------------------------------------------------------------------------------------------------------------

  @Get('sla')
  @ApiOperation({ summary: 'SLA board: policies, recent breaches and KPIs' })
  slaBoard() {
    return this.sla.board();
  }

  @Post('sla/policies')
  @WRITE
  @ApiOperation({ summary: 'Create a platform SLA policy' })
  createPolicy(@Body(zodPipe(slaPolicyInputSchema)) body: SlaPolicyInput) {
    return this.sla.createPolicy(body);
  }

  @Patch('sla/policies/:id')
  @WRITE
  @ApiOperation({ summary: 'Update a platform SLA policy' })
  updatePolicy(
    @id() uuid: string,
    @Body(zodPipe(updateSlaPolicyRequestSchema)) body: UpdateSlaPolicyRequest,
  ) {
    return this.sla.updatePolicy(uuid, body);
  }

  @Delete('sla/policies/:id')
  @WRITE
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a platform SLA policy' })
  async deletePolicy(@id() uuid: string) {
    await this.sla.deletePolicy(uuid);
  }

  // --- customers ------------------------------------------------------------------------------------------------------------------

  @Get('customers')
  @ApiOperation({ summary: 'Workspaces ranked by support load' })
  listCustomers(@Query(zodPipe(customersQuerySchema)) q: CustomersQuery) {
    return this.customers.list(q);
  }

  @Get('customers/:id')
  @ApiOperation({ summary: 'One workspace: stats and its ticket history' })
  customer(@id() uuid: string) {
    return this.customers.detail(uuid);
  }

  // --- playbooks ------------------------------------------------------------------------------------------------------------------

  @Get('playbooks')
  @ApiOperation({ summary: 'Playbook library with KPIs' })
  listPlaybooks() {
    return this.playbooks.list();
  }

  @Get('playbooks/runnable')
  @ApiOperation({ summary: 'Active manual playbooks, for the ticket panel picker' })
  runnable() {
    return this.playbooks.runnable();
  }

  @Post('playbooks')
  @WRITE
  @ApiOperation({ summary: 'Create a playbook' })
  createPlaybook(@Body(zodPipe(createPlaybookRequestSchema)) body: CreatePlaybookRequest) {
    return this.playbooks.create(body);
  }

  @Patch('playbooks/:id')
  @WRITE
  @ApiOperation({ summary: 'Pause or activate a playbook' })
  setPlaybookActive(
    @id() uuid: string,
    @Body(zodPipe(setPlaybookActiveRequestSchema)) body: SetPlaybookActiveRequest,
  ) {
    return this.playbooks.setActive(uuid, body);
  }

  @Delete('playbooks/:id')
  @WRITE
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a playbook' })
  async deletePlaybook(@id() uuid: string) {
    await this.playbooks.remove(uuid);
  }

  @Post('tickets/:id/playbooks/:playbookId/run')
  @WRITE
  @HttpCode(200)
  @ApiOperation({ summary: 'Run a playbook on a ticket' })
  runPlaybook(@id() uuid: string, @Param('playbookId', zodPipe(uuidSchema)) playbookId: string) {
    return this.playbooks.run(uuid, playbookId);
  }

  // --- reports --------------------------------------------------------------------------------------------------------------------

  @Get('reports')
  @ApiOperation({
    summary: 'Volume, response and resolution times, SLA compliance, status mix, top agents',
  })
  report(@Query(zodPipe(reportsQuerySchema)) q: ReportsQuery) {
    return this.reports.report(q.days);
  }

  @Get('reports/export.csv')
  @ApiOperation({ summary: 'Every ticket as CSV' })
  async exportCsv(@Res({ passthrough: true }) res: Response) {
    const file = await this.reports.exportCsv();
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
    });
    return new StreamableFile(Buffer.from(file.body, 'utf8'));
  }
}
