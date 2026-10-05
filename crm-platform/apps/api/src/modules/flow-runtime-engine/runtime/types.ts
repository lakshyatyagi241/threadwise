import type { FlowRunEndReason, FlowRunSource, FlowRunStatus } from '@crm/contracts';
import type { RuntimeGraph } from '../graph/runtime-graph';
import type { VariableBag } from './variables';

/** One option of a choice menu. `id` is what a tap sends back; the text is what the customer saw. */
export interface MenuItem {
  id: string;
  text: string;
}

/**
 * What a parked run waits for (WD-FLR-015: `waitingForInput`). `Question` covers Ask and Buttons, `List` a list node, `Poll` a
 * poll; `answerItems` are the options of a Question, `listItems` the rows of a List.
 */
export interface WaitSpec {
  nodeId: string;
  /** The variable the answer is stored under (and under the node id). */
  variable: string;
  kind: 'Question' | 'List' | 'Poll' | 'Custom';
  /** `Custom` only: the node type whose executor decodes the answer (`onReply`), and what it keeps between the question and the answer. */
  handler?: string;
  data?: Record<string, unknown>;
  /** Overrides the run's idle limit for this wait (a form the customer fills in, a cart they may abandon). */
  timeoutSeconds?: number;
  /** When the wait times out, leave the node by this port instead of ending the run (a Google Form's `timeout`, a shop's `abandoned`). */
  timeoutPort?: number;
  answerItems?: MenuItem[];
  listItems?: ListRow[];
  /** A buttons menu stays tappable after a leaf branch finishes (WD-FLR-018 rule 7). */
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
 * The menus the run has shown (WD-FLR-018 rule 3): the latest one, kept so a dead end re-arms it, and every one by node, so a tap
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

/** A message in the flow's own vocabulary; the sender renders it for the channel or degrades it (WD-FLR-019). */
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
  | { kind: 'location'; latitude: number; longitude: number; name?: string; address?: string }
  /** Asks the customer to share a location: WhatsApp's "send location" button where the channel has it, else `body` and the `hint`. */
  | { kind: 'location_request'; body: string; hint?: string }
  /**
   * An approved WhatsApp template (WD-FLR-026). `variables` are the Cloud API's positional or named body parameters; `text` is the
   * message as the customer reads it (header, body, footer with the values filled in), what a channel without templates is sent
   * and what the thread shows; `buttons` are the quick replies, numbered in that text.
   */
  | {
      kind: 'template';
      name: string;
      language: string;
      variables: Record<string, string>;
      /** The provider's own component list, when `variables` cannot say it (a header with placeholders). */
      components?: Array<Record<string, unknown>>;
      text: string;
      buttons?: MenuItem[];
    }
  /** A WhatsApp Form (a Meta flow message, WD-FLR-043): opens the published form behind `flowId`; the submission comes back as an outside event. */
  | { kind: 'form'; body: string; flowId: string; flowToken: string; cta: string };

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
  /** A branch ran out of nodes: re-arm the last menu, or end when the customer was never shown one (WD-FLR-016 rule 6). */
  | { kind: 'park' }
  | { kind: 'end'; reason: FlowRunEndReason }
  /** Sub-flow (WD-FLR-031): replace the running graph with another flow's, keep the variables, start at its first node. */
  | { kind: 'subflow'; flowId: number | string }
  | { kind: 'halt'; reason: string }
  | { kind: 'fail'; code: string; reason: string };

export interface NodeContext {
  run: RunState;
  /** Stable for this execution of the node (`flow:<run>:<step>:<node>`): the key for a side effect that must not happen twice. */
  stepKey: string;
  node: { id: string; type: string; props: Record<string, unknown> };
  /** Sends one message; the id of the send is stable for this step, so a retried step never sends twice. */
  send(message: OutboundMessage): Promise<SendOutcome>;
  /** Renders `{{tags}}` against the run's variables. */
  render(template: unknown): string;
  /** Adds a line to this step's entry in the run log (a skipped send, a warning). */
  note(text: string): void;
  now(): Date;
}

/** What a `Custom` wait's executor decides about an answer (a customer's reply, or an outside event such as a form submission). */
export type CustomDecision =
  | { action: 'ignore' }
  /** Not the answer yet: keep waiting, optionally with updated `data`/variables. */
  | { action: 'stay'; setVars?: Record<string, unknown>; data?: Record<string, unknown> }
  | { action: 'route'; port: number; setVars?: Record<string, unknown> }
  | { action: 'end'; reason: FlowRunEndReason }
  | { action: 'fail'; code: string; reason: string };

export interface NodeExecutor {
  readonly types: readonly string[];
  execute(ctx: NodeContext): Promise<NodeResult>;
  /** Decodes the answer to a `Custom` wait this executor parked (`wait.handler` is the node type). */
  onReply?(ctx: NodeContext, reply: InboundReply): Promise<CustomDecision>;
}

/** The executors a domain adds to the core set; each is an injectable class listed under this token (see `node-executors.ts`). */

/** What the channel adapter hands the engine for a customer's message (WD-FLR-018 port notes: never a provider shape). */
export interface InboundReply {
  kind: 'text' | 'tap' | 'location' | 'media' | 'external';
  /** `external`: what the outside event carried (a form submission, a payment result). */
  data?: Record<string, unknown>;
  /** The option id a tap carried (button, list row or template button); empty for typed text. */
  id: string;
  text: string;
  /** A stored link to the customer's file, set when the wait accepts media. */
  mediaUrl?: string;
}
