import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { ContactsService } from '../crm';
import {
  LeadChatDigestRepository,
  LeadChatDigestService,
  LeadStageLineService,
} from '../lead-scoring';
import { InboxSystemNotes } from '../team-inbox-conversations';
import { GrowthActionsService } from './growth-actions.service';
import { GrowthGateService, type GrowthContext } from './growth-gate.service';
import { GrowthRepository, type Stage } from './growth.repository';
import { serviceRuleGroupName } from './growth.rules';

const LIST_CAP = 25;
const SUGGESTION_MODULE = 'lifecycle_stage_suggestions';

const forwardStages = (stages: readonly Stage[]): Stage[] =>
  stages.filter((s) => !s.isWon && !s.isLost).sort((a, b) => a.position - b.position);

/**
 * The work the workers do for the pilot on a schedule or after an event, one workspace at a time and only after the gate has said yes:
 * the engagement stage rule, the guarded automatic stage change, and the scans that raise lapsed, service-due and unanswered actions.
 */
@Injectable()
export class GrowthAutomationService {
  private readonly logger = new Logger(GrowthAutomationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: GrowthRepository,
    private readonly gate: GrowthGateService,
    private readonly actions: GrowthActionsService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
    private readonly digests: LeadChatDigestService,
    private readonly digestRepo: LeadChatDigestRepository,
    private readonly systemNotes: InboxSystemNotes,
    private readonly stageLines: LeadStageLineService,
  ) {}

  // --- the engagement stage rule: no chat needed --------------------------------------------------------------------

  /**
   * A contact in the first stage that opened enough campaigns (and belongs to a group, when asked) is suggested for the next stage.
   * The suggestion goes into the same tray as the chat ones; its confidence grows with the opens. Returns how many were suggested.
   */
  async engagementStageRule(orgId: number): Promise<number> {
    const ctx = await this.gate.ifOn(orgId, 'engagement_stage_rules');
    if (!ctx) return 0;
    const stages = forwardStages(
      await this.db.txAs({ orgId, userId: null }, (tx) => this.repo.stages(tx, orgId)),
    );
    const first = stages[0];
    const next = stages[1];
    if (!first || !next) return 0;
    const rule = ctx.config.stageRule;
    const found = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.engagementStageCandidates(tx, orgId, first.value, rule),
    );
    let made = 0;
    for (const c of found) {
      const confidence = Math.min(0.95, Math.round((0.7 + 0.05 * c.opens) * 100) / 100);
      const reasons = [
        `Opened ${c.opens} campaigns in the last ${rule.windowDays} days`,
        ...(c.groups > 0 ? [`In ${c.groups} group${c.groups === 1 ? '' : 's'}`] : []),
      ];
      await this.db.txAs({ orgId, userId: null }, async (tx) => {
        const id = await this.digestRepo.replacePending(tx, orgId, {
          contactId: c.contactId,
          digestId: null,
          fromStage: first.value,
          toStage: next.value,
          confidence,
          reasons,
          source: 'engagement',
        });
        await this.audit.record(tx, {
          module: SUGGESTION_MODULE,
          recordId: id,
          action: 'insert',
          delta: {
            source: { old: null, new: 'engagement' },
            toStage: { old: first.value, new: next.value },
          },
        });
      });
      made += 1;
    }
    return made;
  }

  // --- the guarded automatic stage change ---------------------------------------------------------------------------

  /**
   * Applies, by itself, the open stage suggestions that are confident enough: only a move FORWARD to a stage that is not a closing
   * one, only while the day's cap is not reached, only if the contact is still where the suggestion started, and always with an undo
   * (the suggestion becomes `auto_applied`, and `undone` when someone puts the contact back). Returns how many were applied.
   */
  async autoStage(orgId: number): Promise<number> {
    const ctx = await this.gate.ifOn(orgId, 'auto_stage');
    if (!ctx) return 0;
    return this.applyConfident(orgId, ctx, null);
  }

  /** The same, for the one contact a chat reading just made a suggestion for (so the move is not left waiting for the next sweep). */
  async autoStageFor(orgId: number, ctx: GrowthContext, contactId: number): Promise<void> {
    if (!ctx.features.auto_stage) return;
    await this.applyConfident(orgId, ctx, contactId);
  }

  private async applyConfident(
    orgId: number,
    ctx: GrowthContext,
    onlyContact: number | null,
  ): Promise<number> {
    const stages = await this.db.txAs({ orgId, userId: null }, (tx) => this.repo.stages(tx, orgId));
    const position = new Map(stages.map((s) => [s.value, s.position]));
    const flags = new Map(stages.map((s) => [s.value, s]));
    const labels = new Map(stages.map((s) => [s.value, s.label]));
    const { applied, candidates } = await this.db.txAs({ orgId, userId: null }, async (tx) => ({
      applied: await this.repo.autoAppliedToday(tx, orgId),
      candidates: await this.repo.autoStageCandidates(
        tx,
        orgId,
        ctx.config.autoStage.minConfidence,
        200,
      ),
    }));
    let room = ctx.config.autoStage.dailyCap - applied;
    let done = 0;
    for (const s of candidates) {
      if (room <= 0) break;
      if (onlyContact !== null && s.contactId !== onlyContact) continue;
      const to = flags.get(s.toStage);
      const forward =
        (position.get(s.toStage) ?? -1) > (position.get(s.fromStage) ?? Number.MAX_SAFE_INTEGER);
      if (!to || to.isWon || to.isLost || !forward) continue;
      const moved = await this.contacts.changeStageAsSystem(orgId, s.contactId, {
        expectFrom: s.fromStage,
        to: s.toStage,
      });
      await this.db.txAs({ orgId, userId: null }, async (tx) => {
        // Moved: it is `auto_applied`. Not moved (a person got there first): it is stale, not an action of ours.
        if (moved) {
          await this.repo.markSuggestion(tx, orgId, s.id, 'pending', 'auto_applied');
          await this.audit.record(tx, {
            module: SUGGESTION_MODULE,
            recordId: s.id,
            action: 'update',
            delta: { status: { old: 'pending', new: 'auto_applied' } },
          });
        } else {
          await this.digestRepo.supersedePending(tx, orgId, s.contactId);
        }
      });
      if (moved) {
        done += 1;
        room -= 1;
        // The people in the chat see it happen, with an Undo on the line.
        await this.stageLines.write(orgId, {
          suggestionUuid: s.uuid,
          contactId: s.contactId,
          fromLabel: labels.get(s.fromStage) ?? s.fromStage,
          toLabel: to.label,
          action: 'auto',
        });
      }
    }
    return done;
  }

  // --- the scans -----------------------------------------------------------------------------------------------------

  /** Customers gone quiet for the configured days: the first few, as actions (the rest are in the Lapsed audience). */
  async lapsedScan(orgId: number): Promise<number> {
    const ctx = await this.gate.ifOn(orgId, 'engagement_audiences');
    if (!ctx) return 0;
    const ids = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.lapsedIds(tx, orgId, ctx.config.lapsedDays),
    );
    let n = 0;
    for (const contactId of ids.slice(0, LIST_CAP)) {
      const made = await this.actions.raise(orgId, {
        type: 'lapsed',
        contactId,
        severity: 'info',
        title: 'A customer has gone quiet',
        payload: { days: ctx.config.lapsedDays, total: ids.length },
        dedupeKey: `lapsed:${contactId}`,
      });
      if (made) n += 1;
    }
    return n;
  }

  /** Contacts whose service date is due under one of the workspace's rules. */
  async serviceDueScan(orgId: number): Promise<number> {
    const ctx = await this.gate.ifOn(orgId, 'service_rules');
    if (!ctx) return 0;
    let n = 0;
    for (const [index, rule] of ctx.config.serviceRules.entries()) {
      const ids = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.serviceDueIds(tx, orgId, rule),
      );
      for (const contactId of ids.slice(0, LIST_CAP)) {
        const made = await this.actions.raise(orgId, {
          type: 'service_due',
          contactId,
          severity: 'info',
          title: `${rule.label} is due`,
          payload: {
            rule: rule.label,
            afterDays: rule.afterDays,
            group: serviceRuleGroupName(rule),
            total: ids.length,
          },
          dedupeKey: `service_due:${index}:${contactId}`,
        });
        if (made) n += 1;
      }
    }
    return n;
  }

  /** Buying and price questions nobody answered for the configured hours; answered ones close themselves. */
  async unansweredScan(orgId: number): Promise<number> {
    const ctx = await this.gate.ifOn(orgId, 'unanswered_watch');
    if (!ctx) return 0;
    const rows = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.unansweredIntent(tx, orgId, ctx.config.unansweredHours),
    );
    let n = 0;
    for (const r of rows) {
      const made = await this.actions.raise(orgId, {
        type: 'unanswered_intent',
        contactId: r.contactId,
        conversationId: r.conversationId,
        digestId: r.digestId,
        severity: r.hoursWaiting >= ctx.config.unansweredHours * 4 ? 'urgent' : 'attention',
        title: 'A buying question has no answer yet',
        payload: { hours: r.hoursWaiting, intent: r.intent },
        dedupeKey: `unanswered:${r.conversationId}`,
      });
      if (made) n += 1;
    }
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.closeAnsweredUnanswered(tx, orgId),
    );
    return n;
  }

  // --- the handover summary --------------------------------------------------------------------------------------------

  /**
   * When a conversation is handed to someone, a note at the top of the thread says what the AI made of it, so the new person does not
   * have to read it all. Uses the latest reading (at most a week old), or reads the chat now. Once per assignment (`key`).
   */
  async handover(orgId: number, conversationUuid: string, key: string): Promise<boolean> {
    const ctx = await this.gate.ifOn(orgId, 'handover_summary');
    if (!ctx) return false;
    const conv = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.conversationContact(tx, orgId, conversationUuid),
    );
    if (!conv || conv.contactId === null) return false;
    const read = () =>
      this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.latestSummary(tx, orgId, conv.contactId!, 7),
      );
    let latest = await read();
    if (!latest) {
      try {
        await this.digests.digest(orgId, conv.contactId, 'chat');
      } catch (err) {
        this.logger.debug({ orgId, err }, 'handover: the chat could not be read now');
      }
      latest = await read();
    }
    if (!latest || (!latest.summary && latest.source === 'ai')) return false;
    const body = latest.summary
      ? `Handover summary (AI): ${latest.summary}`
      : `Handover summary: the contact tapped menu options about "${latest.intent.replace(/_/g, ' ')}".`;
    return this.systemNotes.create(orgId, conversationUuid, body, key);
  }
}
