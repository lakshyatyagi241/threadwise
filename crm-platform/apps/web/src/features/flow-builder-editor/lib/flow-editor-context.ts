import { createContext } from 'react';

/** What the editors under a builder screen need to know about the bot they edit: its id (once it has been saved) and whether it is a website chat bot. */
export interface FlowEditorValue {
  flowId: string | null;
  web: boolean;
}

export const FlowEditorContext = createContext<FlowEditorValue>({ flowId: null, web: false });
