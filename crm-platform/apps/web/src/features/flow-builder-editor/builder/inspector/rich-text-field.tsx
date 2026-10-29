'use client';

import type { FlowNode } from '@crm/contracts';
import { nodeVariables } from '../../lib/flow-variables';
import { MessageField } from '../message-field';

/**
 * The text box of a message-like field in the node form: the same box as the Simple builder's message, with formatting (bold,
 * italic, strike, monospace, lists), an emoji picker and the variable menu, and Ctrl/Cmd+B and Ctrl/Cmd+I. `max` is the channel's limit.
 */
export function RichTextField({
  value,
  onChange,
  nodes,
  label,
  rows = 4,
  max,
  placeholder,
}: {
  value: unknown;
  onChange: (next: string) => void;
  /** The flow's nodes, for the variables the flow has saved so far. */
  nodes: readonly FlowNode[];
  label: string;
  rows?: number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <MessageField
      value={typeof value === 'string' ? value : value == null ? '' : String(value)}
      onChange={onChange}
      rows={rows}
      max={max}
      placeholder={placeholder}
      label={label}
      variables={nodeVariables(nodes ?? [])}
    />
  );
}
