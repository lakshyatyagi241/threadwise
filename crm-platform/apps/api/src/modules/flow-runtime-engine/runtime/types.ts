import type { FlowRunEndReason, FlowRunSource, FlowRunStatus } from '@crm/contracts';
import type { RuntimeGraph } from '../graph/runtime-graph';
import type { VariableBag } from './variables';

/** One option of a choice menu. `id` is what a tap sends back; the text is what the customer saw. */
export interface MenuItem {
  id: string;
  text: string;
}

/**
 * What a parked run waits for (TW-FLR-015: `waitingForInput`). `Question` covers Ask and Buttons, `List` a list node, `Poll` a
 * poll; `answerItems` are the options of a Question, `listItems` the rows of a List.
 */
export interface WaitSpec {
  nodeId: string;
  /** The variable the answer is stored under (and under the node id). */
  variable: string;
  kind: 'Question' | 'List' | 'Poll';
  answerItems?: MenuItem[];
  listItems?: ListRow[];
  /** A buttons menu stays tappable after a leaf branch finishes (TW-FLR-018 rule 7). */
  persistent?: boolean;
  acceptMedia?: boolean;
  allowMultiple?: boolean;
}

export interface ListRow {
  /** The row id the customer's tap carries: `list_<nodeId>_p<i>`. */
  id: string;
  title: string;
  section: string;
  /** The output port the row routes to (index + 1). */
  port: number;
}

/**
 * The menus the run has shown (TW-FLR-018 rule 3): the latest one, kept so a dead end re-arms it, and every one by node, so a tap
 * on an older message still finds the menu it came from.
 */
export interface MenuMemory {
  latest: { nodeId: string; variable: string; answerItems: MenuItem[] } | null;
  byNode: Record<string, MenuItem[]>;
}

/** The last thing the customer was sent, for a later "copy to number" node. */
export interface LastOut {
  kind: string;
  text: string;
  url: string;
  caption: string;
  filename: string | null;
}

/** A run as the engine holds it between steps. */
export interface RunState {
  id: number;
  uuid: string;
  orgId: number;
  flowId: number;
  subscriberId: number | null;
  contactId: number | null;
  channelId: number | null;
  /** The channel's uuid and kind, and the contact's uuid: what the sender and the inbox facade take. */
  channelUuid: string | null;
  channelKind: string | null;
  contactUuid: string | null;
  peerKey: string;
  conversationId: number | null;
  source: FlowRunSource;
  triggerText: string | null;
  status: FlowRunStatus;
  graph: RuntimeGraph;
  currentNodeId: string | null;
  stepSeq: number;
  vars: VariableBag;
  visits: Record<string, number>;
  wait: WaitSpec | null;
  menus: MenuMemory;
  lastOut: LastOut | null;
  timeoutSeconds: number;
  cooldownSeconds: number;
  haltReason: string | null;
  startedAt: Date;
  expiresAt: Date | null;
  maxExpiresAt: Date;
  resumeAt: Date | null;
}

/** A message in the flow's own vocabulary; the sender renders it for the channel or degrades it (TW-FLR-019). */
export type OutboundMessage =
  | { kind: 'text'; body: string }
  | {
      kind: 'media';
      mediaKind: 'image' | 'video' | 'audio' | 'document';
      url: string;
      caption?: string;
      filename?: string;
      mimeType?: string;
    }
  | { kind: 'buttons'; body: string; header?: string; footer?: string; buttons: MenuItem[] }
  | {
      kind: 'list';
      body: string;
      header?: string;
      footer?: string;
      button: string;
      sections: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    }
  | { kind: 'cta_url'; body: string; header?: string; footer?: string; text: string; url: string }
  | { kind: 'location'; latitude: number; longitude: number; name?: string; address?: string };

export type SendOutcome =
  | { ok: true }
  /** The message did not go out. `halt`: the channel is down or capped, so the run should wait and try again, not fail. */
  | { ok: false; error: string; code: string; halt: boolean };

/** What a node asks the engine to do next. */
export type NodeResult =
  /** Leave by `port`. `branch` is a routed choice (no pacing pause); a plain move waits the humanising pause first. */
  | { kind: 'advance'; port: number; branch?: boolean }
  | { kind: 'wait'; wait: WaitSpec }
  | { kind: 'sleep'; seconds: number }
  /** A branch ran out of nodes: re-arm the last menu, or end when the customer was never shown one (TW-FLR-016 rule 6). */
  | { kind: 'park' }
  | { kind: 'end'; reason: FlowRunEndReason }
  | { kind: 'halt'; reason: string }
  | { kind: 'fail'; code: string; reason: string };

export interface NodeContext {
  run: RunState;
  node: { id: string; type: string; props: Record<string, unknown> };
  /** Sends one message; the id of the send is stable for this step, so a retried step never sends twice. */
  send(message: OutboundMessage): Promise<SendOutcome>;
  /** Renders `{{tags}}` against the run's variables. */
  render(template: unknown): string;
  /** Adds a line to this step's entry in the run log (a skipped send, a warning). */
  note(text: string): void;
  now(): Date;
}

export interface NodeExecutor {
  readonly types: readonly string[];
  execute(ctx: NodeContext): Promise<NodeResult>;
}

/** What the channel adapter hands the engine for a customer's message (TW-FLR-018 port notes: never a provider shape). */
export interface InboundReply {
  kind: 'text' | 'tap' | 'location' | 'media';
  /** The option id a tap carried (button, list row or template button); empty for typed text. */
  id: string;
  text: string;
  /** A stored link to the customer's file, set when the wait accepts media. */
  mediaUrl?: string;
}
