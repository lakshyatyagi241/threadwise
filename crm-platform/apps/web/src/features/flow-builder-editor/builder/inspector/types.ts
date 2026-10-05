import type { ReactNode } from 'react';
import type { FlbBuilderContext, FlowNode, FlowType, FlbNodeData } from '@crm/contracts';

/**
 * The seam between the canvas and a node's form. A form is a pure function of the node's data and the workspace's
 * reference data; it never touches the graph directly.
 */
export interface FormEnv {
  /** Reference data (tags, teams, templates, senders, ...). Empty lists until the builder context loads. */
  ctx: FlbBuilderContext;
  /** True until the builder context has loaded: dropdowns say "Loading ..." like WaDesk's. */
  loading: boolean;
  /** The channel the flow runs as right now (call, chat, instagram ...). */
  mode: FlowType;
  /** The channel the flow was opened as (a call flow never offers a channel switch). */
  openedAs: FlowType;
  /** Channels the workspace can run a flow on. */
  channels: FlowType[];
  /** Re-fetch the reference data. */
  refresh: () => void;
  toast: (message: string) => void;
  /** Uploads a file for a media / sequence node and returns its public URL. Rejects with a readable message. */
  uploadMedia: (
    file: File,
    kind: 'image' | 'video' | 'audio' | 'document',
  ) => Promise<{ url: string; filename: string }>;
  /** Every node in the flow (for forms that reference other nodes). */
  nodes: readonly FlowNode[];
  /** The saved flow being edited (null before its first save): a Sub-flow node never offers it. */
  flowId: string | null;
}

export interface FormProps {
  node: FlowNode;
  data: FlbNodeData;
  /** Write one key of the node's data (one history entry per call, like WaDesk). */
  set: (key: string, value: unknown) => void;
  /** Write several keys as one change. */
  setMany: (patch: Record<string, unknown>) => void;
  env: FormEnv;
  /**
   * Adds an option to buttons / list / ask / poll nodes with WaDesk's per-type caps and default labels, and shows the
   * "Max 3 quick reply buttons" style toast at the cap.
   */
  addOption: () => void;
  /** Removes option `i` and fixes the edges: the edge on its port goes, higher `p<n>` handles shift down by one. */
  removeOption: (i: number) => void;
}

export type FormComponent = (props: FormProps) => ReactNode;
