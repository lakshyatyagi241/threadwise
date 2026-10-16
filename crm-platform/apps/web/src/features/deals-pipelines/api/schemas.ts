import { z } from 'zod';

/**
 * The shapes the deals screens work with. The wire format is `@crm/contracts` (deals-pipelines): decimal-string money, nested
 * refs, per-currency totals. `mappers.ts` turns a parsed response into these flatter view models (integer minor units, ids
 * instead of nested objects) once, at the boundary, so components never touch the wire shapes.
 */
export {
  DEAL_SOURCES,
  type CreateDealInput,
  type DealSource,
  type DealStatus,
  type StageKind,
} from '@crm/contracts';
import type { DealSource, DealStatus, StageKind } from '@crm/contracts';

export interface Stage {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  /** 0..100. A won stage is 100 and a lost stage 0. */
  probability: number;
  kind: StageKind;
  sortOrder: number;
  /** Deals in the stage, whatever their status. */
  dealCount: number;
  rowVersion: number;
}

export interface Pipeline {
  id: string;
  name: string;
  currency: string;
  isDefault: boolean;
  sortOrder: number;
  stages: Stage[];
  dealCount: number;
  rowVersion: number;
}

export interface ContactRef {
  id: string;
  name: string | null;
  phone: string | null;
}

export interface OwnerRef {
  id: string;
  name: string;
}

export interface Deal {
  id: string;
  title: string;
  pipelineId: string;
  stageId: string;
  status: DealStatus;
  /** In the deal's own currency, integer minor units. */
  valueMinor: number;
  currency: string;
  /**
   * The value in the pipeline's currency, which the column totals add up. The server converts the totals; a card only
   * knows it when its currency is the pipeline's, so a foreign-currency card counts 0 here until the totals are refetched.
   */
  boardValueMinor: number;
  contact: ContactRef | null;
  company: { id: string; name: string } | null;
  owner: OwnerRef | null;
  source: DealSource;
  expectedCloseDate: string | null;
  lostReason: string | null;
  notes: string | null;
  wonAt: string | null;
  lostAt: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface StageSummary {
  stageId: string;
  count: number;
  /** In the pipeline currency (converted by the server when the column mixes currencies). */
  valueMinor: number;
  weightedMinor: number;
}

export interface BoardKpis {
  openCount: number;
  openValueMinor: number;
  forecastMinor: number;
  wonThisMonthCount: number;
  wonThisMonthValueMinor: number;
  winRate: number;
}

export interface BoardColumnData {
  stageId: string;
  summary: StageSummary;
  deals: Deal[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface Board {
  pipelineId: string;
  currency: string;
  columns: BoardColumnData[];
  kpis: BoardKpis;
  /** Currencies that have no exchange rate, so some totals leave them out. */
  unconverted: string[];
}

export type ActivityType =
  'note' | 'call' | 'message' | 'email' | 'meeting' | 'task' | 'stage_change';

export interface Activity {
  id: string;
  type: ActivityType;
  body: string | null;
  /** "From, to" names of a stage change. */
  stageChange: { from: string | null; to: string } | null;
  userName: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  doneAt: string | null;
  done: boolean;
  createdAt: string;
}

export interface ReportStage {
  stageId: string;
  name: string;
  color: string;
  kind: StageKind;
  count: number;
  valueMinor: number;
  weightedMinor: number;
}

export interface Report {
  currency: string;
  timezone: string;
  unconverted: string[];
  openCount: number;
  openValueMinor: number;
  forecastMinor: number;
  wonCount: number;
  wonValueMinor: number;
  wonThisMonthCount: number;
  wonThisMonthValueMinor: number;
  avgDaysToClose: number | null;
  lostCount: number;
  winRate: number;
  byStage: ReportStage[];
  months: Array<{ month: string; won: number; lost: number }>;
  leaders: Array<{ userId: string; name: string; won: number; valueMinor: number }>;
  lostReasons: Array<{ reason: string | null; count: number }>;
}

export interface LostReason {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  dealCount: number;
  rowVersion: number;
}

export interface DealSettings {
  lostReasonRequired: boolean;
  rowVersion: number;
}

export interface Member {
  id: string;
  fullName: string;
}

export interface ContactHit {
  id: string;
  name: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone: string | null;
}

/** Only what the members and contact pickers read; the rest of those responses is ignored. */
export const memberSchema = z.object({ id: z.string(), fullName: z.string() });
export const memberPageSchema = z.object({ data: z.array(memberSchema) });
export const contactHitSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  phone: z.string().nullable(),
});
export const contactHitPageSchema = z.object({ data: z.array(contactHitSchema) });

export interface UpdateDealInput {
  title?: string;
  value?: string;
  currency?: string;
  ownerId?: string | null;
  contactId?: string | null;
  /** The company (uuid); null clears it. Omit to keep it. */
  companyId?: string | null;
  expectedCloseDate?: string | null;
}

export interface MoveDealInput {
  stageId: string;
  /** The card that ends up directly above the dropped one, if any. */
  afterDealId?: string | null;
  /** The card that ends up directly below it, if any. */
  beforeDealId?: string | null;
  /** A catalogue reason, or free text; the server needs one for a lost stage when the workspace requires it. */
  lostReasonId?: string;
  lostReason?: string;
}

export interface StageInput {
  name: string;
  color: string;
  probability: number;
  kind: StageKind;
}
