import type { TplButton, TplStatus, TplVariableMap } from '@crm/contracts';

/** What a flow's Template node needs to send one template (TW-FLR-026); no internal columns beyond the row id. */
export interface FlowTemplate {
  id: number;
  uuid: string;
  name: string;
  language: string;
  status: TplStatus;
  header: string | null;
  body: string;
  footer: string | null;
  buttons: TplButton[];
  variableMap: TplVariableMap;
  parameterFormat: 'POSITIONAL' | 'NAMED';
}
