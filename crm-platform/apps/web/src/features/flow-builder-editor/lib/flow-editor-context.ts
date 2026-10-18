import { createContext } from 'react';

/** What the editors under a builder screen need to know about the bot they edit: its id (once it has been saved) and whether it is a website chat bot. */
export interface FlowEditorValue {
  flowId: string | null;
  web: boolean;
  /** The channel the bot runs on right now: the other bots its steps may start are the ones of this channel. Unset only in tests. */
  channel?: string;
}

export const FlowEditorContext = createContext<FlowEditorValue>({ flowId: null, web: false });
