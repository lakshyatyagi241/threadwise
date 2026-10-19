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
  /** `text`, `catalog`, `carousel`...; what the Cloud API payload builder branches on. */
  templateType?: string;
  /** `image`, `video`, `document` or `location` when the header is not text. */
  attachmentType?: string | null;
  /** The public link of the header's sample file (the stored `attachment_file` is a Meta handle, which cannot be sent as a link). */
  headerMediaUrl?: string | null;
  /** The pin of a `location` header. */
  headerLocation?: unknown;
}
