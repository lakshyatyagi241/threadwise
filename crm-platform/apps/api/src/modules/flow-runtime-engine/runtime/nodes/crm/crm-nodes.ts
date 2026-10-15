import { Inject, Injectable } from '@nestjs/common';
import { consentChannelOfKind } from '@crm/contracts';
import { CONVERSATIONS_FACADE, type ConversationsFacade } from '../../../../chat-conversations';
import { ContactConsentService } from '../../../../contact-consent';
import { ContactGroupsService, ContactsService, SegmentsService } from '../../../../crm';
import { DatabaseService } from '../../../../../infra/db/database.service';
import type { NodeContext, NodeExecutor, NodeResult } from '../../types';
import { listConfig, segmentConfig, sessionOpen, updateFieldConfig, UUID_RE } from './crm-rules';

const advance: NodeResult = { kind: 'advance', port: 1 };
const YES: NodeResult = { kind: 'advance', port: 1, branch: true };
const NO: NodeResult = { kind: 'advance', port: 2, branch: true };

const data = (ctx: NodeContext): Record<string, unknown> => {
  const d = ctx.node.props.data;
  return d !== null && typeof d === 'object' ? (d as Record<string, unknown>) : {};
};
const reasonOf = (err: unknown): string =>
  err instanceof Error ? err.message : 'something went wrong';

/**
 * Node group `crm`: the steps that read or change the run's contact in the CRM, beyond Tag (TW-FLR-072 to 076).
 *
 * - Update contact field: one contact column or custom property; the new value also goes into the run's variables, so a later
 *   Condition sees it.
 * - Add to list / Remove from list: the list is a contact group.
 * - Is in list, Is in segment, WhatsApp active session: conditions with a yes port (1) and a no port (2). A condition that cannot be
 *   decided (no contact, a list or segment that is gone) answers no, and says why in the run log.
 *
 * As for every action node, a step never stops the flow: a refusal is a line in the run log and the flow moves on.
 */
@Injectable()
export class CrmNodes implements NodeExecutor {
  readonly types: readonly string[] = [
    'UpdateContact',
    'ListMember',
    'InList',
    'InSegment',
    'WaSession',
    'ContactConsent',
  ];

  constructor(
    private readonly contacts: ContactsService,
    private readonly groups: ContactGroupsService,
    private readonly segments: SegmentsService,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
    private readonly ledger: ContactConsentService,
    private readonly db: DatabaseService,
  ) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    switch (ctx.node.type) {
      case 'UpdateContact':
        return this.update(ctx);
      case 'ListMember':
        return this.member(ctx);
      case 'InList':
        return this.inList(ctx);
      case 'InSegment':
        return this.inSegment(ctx);
      case 'ContactConsent':
        return this.consent(ctx);
      default:
        return this.session(ctx);
    }
  }

  private async update(ctx: NodeContext): Promise<NodeResult> {
    const cfg = updateFieldConfig(data(ctx), ctx.render);
    if (!cfg) {
      ctx.note('no field chosen: skipped');
      return advance;
    }
    const run = ctx.run;
    if (run.contactId === null) {
      ctx.note('this run has no contact to update: skipped');
      return advance;
    }
    try {
      const done = await this.contacts.setFieldFromFlow(
        run.orgId,
        run.contactId,
        cfg.field,
        cfg.value,
      );
      if (!done) {
        ctx.note(
          `field "${cfg.field}" could not be set (not a contact field of this workspace, or a blank name)`,
        );
        return advance;
      }
      run.vars[cfg.field] = done.stored;
      ctx.note(`contact ${cfg.field} set`);
    } catch (err) {
      ctx.note(`update step failed: ${reasonOf(err)}`);
    }
    return advance;
  }

  private async member(ctx: NodeContext): Promise<NodeResult> {
    const cfg = listConfig(data(ctx));
    if (!cfg.groupId && !cfg.name) {
      ctx.note('no list chosen: skipped');
      return advance;
    }
    const run = ctx.run;
    if (run.contactId === null) {
      ctx.note('this run has no contact for the list: skipped');
      return advance;
    }
    try {
      const done = await this.groups.applyFromFlow(run.orgId, run.contactId, cfg.action, {
        groupId: cfg.groupId,
        name: cfg.name,
      });
      ctx.note(
        `list "${done.groupName}" ${cfg.action === 'add' ? 'joined' : 'left'}${done.changed ? '' : ' (no change)'}`,
      );
    } catch (err) {
      ctx.note(`list step failed: ${reasonOf(err)}`);
    }
    return advance;
  }

  /**
   * A button's Opt in / Opt out: the contact's own answer, written to the consent ledger (source `flow`) so the proof, the per-channel
   * state, the roll-up flag and the audit row all move together. A repeat of the same step (a retry) writes nothing twice.
   */
  private async consent(ctx: NodeContext): Promise<NodeResult> {
    const optIn = data(ctx).action === 'opt_in';
    const run = ctx.run;
    if (run.contactId === null) {
      ctx.note('this run has no contact to opt in or out: skipped');
      return advance;
    }
    const contactId = run.contactId;
    // The test chat is a WhatsApp stand-in. A call and the website chat have no marketing consent of their own (the ledger would
    // record a withdrawal on them that still switches off the contact's WhatsApp marketing), so the step is skipped and says so.
    const kind = run.channelKind === 'simulator' ? 'whatsapp' : (run.channelKind ?? '');
    const channel = consentChannelOfKind(kind);
    if (channel === null || channel === 'webchat' || channel === 'voice') {
      ctx.note('this channel has no marketing consent to change: skipped');
      return advance;
    }
    try {
      const done = await this.db.txAs({ orgId: run.orgId }, (tx) =>
        this.ledger.recordInTx(tx, run.orgId, {
          contactId,
          channel,
          action: optIn ? 'granted' : 'withdrawn',
          source: 'flow',
          evidence: { flowId: String(run.flowId), reference: `run:${run.id}:${ctx.node.id}` },
          note: optIn ? 'Opted in with a button in a flow' : 'Opted out with a button in a flow',
          idempotencyKey: `flow:${ctx.stepKey}`,
          announceOptIn: true,
        }),
      );
      ctx.note(
        `${optIn ? 'opted in' : 'opted out'} of marketing${done.stateChanged ? '' : ' (no change)'}`,
      );
    } catch (err) {
      // A consent change that was not written must not look as if it was: the run stops, and the log says why.
      return {
        kind: 'fail',
        code: 'CONSENT_WRITE_FAILED',
        reason: `${optIn ? 'opt-in' : 'opt-out'} was not saved: ${reasonOf(err)}`,
      };
    }
    return advance;
  }

  private async inList(ctx: NodeContext): Promise<NodeResult> {
    const cfg = listConfig(data(ctx));
    const run = ctx.run;
    if ((!cfg.groupId && !cfg.name) || run.contactId === null) {
      ctx.note('no list or no contact: no');
      return NO;
    }
    try {
      const yes = await this.groups.hasMemberFromFlow(run.orgId, run.contactId, {
        groupId: cfg.groupId,
        name: cfg.name,
      });
      return yes ? YES : NO;
    } catch (err) {
      ctx.note(`list check failed: ${reasonOf(err)}: no`);
      return NO;
    }
  }

  private async inSegment(ctx: NodeContext): Promise<NodeResult> {
    const { segmentId } = segmentConfig(data(ctx));
    const run = ctx.run;
    if (!UUID_RE.test(segmentId) || run.contactId === null) {
      ctx.note('no segment or no contact: no');
      return NO;
    }
    try {
      const yes = await this.segments.containsContactFromFlow(run.orgId, segmentId, run.contactId);
      return yes ? YES : NO;
    } catch (err) {
      ctx.note(`segment check failed: ${reasonOf(err)}: no`);
      return NO;
    }
  }

  private async session(ctx: NodeContext): Promise<NodeResult> {
    const run = ctx.run;
    if (!run.channelUuid) {
      ctx.note('no channel: no session');
      return NO;
    }
    try {
      const thread = await this.conversations.findThread(run.channelUuid, run.peerKey);
      return sessionOpen(thread?.lastInboundAt ?? null, data(ctx).hours, ctx.now()) ? YES : NO;
    } catch (err) {
      ctx.note(`session check failed: ${reasonOf(err)}: no`);
      return NO;
    }
  }
}
