import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  BOARD_COLUMNS,
  type BoardCard,
  type MoveCardRequest,
  type SuppBoardResponse,
  type SuppTicketPriority,
  type SuppTicketStatus,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { SupportStore } from './support-store';
import { TicketActions } from './ticket-actions.service';
import { excerpt } from './ticket-rules';

interface CardRow {
  uuid: string;
  ticket_number: string;
  subject: string;
  message: string;
  name: string;
  email: string;
  priority: SuppTicketPriority;
  status: SuppTicketStatus;
  created_at: Date;
  row_version: number;
}

/** The team-inbox kanban (WD-SUPP-015, 016): four columns, newest activity first, at most 500 cards. */
@Injectable()
export class BoardService {
  constructor(
    private readonly store: SupportStore,
    private readonly actions: TicketActions,
  ) {}

  async board(mineOnly: boolean): Promise<SuppBoardResponse> {
    const me = RequestContextStore.require().actorId;
    if (!me) throw AppError.unauthenticated();
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT uuid, ticket_number, subject, message, name, email, priority, status, created_at, row_version
        FROM support_tickets
        WHERE status IN ('open', 'in_progress', 'pending', 'resolved')
          ${mineOnly ? sql`AND assigned_agent_id = ${me}` : sql``}
        ORDER BY updated_at DESC, id DESC LIMIT 500
      `);
      const columns: SuppBoardResponse['columns'] = {
        open: [],
        in_progress: [],
        pending: [],
        resolved: [],
      };
      for (const r of res.rows as unknown as CardRow[]) {
        const card: BoardCard = {
          id: r.uuid,
          ticketNumber: r.ticket_number,
          subject: r.subject,
          excerpt: excerpt(r.message, 100),
          customer: r.name || r.email,
          priority: r.priority,
          status: r.status,
          createdAt: new Date(r.created_at).toISOString(),
          rowVersion: r.row_version,
        };
        columns[r.status as (typeof BOARD_COLUMNS)[number]].push(card);
      }
      return { columns, mineOnly };
    });
  }

  /**
   * Drag and drop (WD-SUPP-016). Goes through the shared status transition, so moving a card out of Resolved clears
   * resolved_at (WaDesk's kanban kept the stale stamp) and the move is audited with its ticket.
   */
  async move(uuid: string, input: MoveCardRequest): Promise<{ ok: true; rowVersion: number }> {
    return this.store.tx(async (tx) => {
      const t = await this.actions.lockAt(tx, uuid, input.rowVersion);
      await this.actions.statusIn(tx, t, input.status);
      return { ok: true as const, rowVersion: t.row_version + 1 };
    });
  }
}
