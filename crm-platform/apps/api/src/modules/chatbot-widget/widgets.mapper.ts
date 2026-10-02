import type {
  Widget,
  WidgetListItem,
  WidgetMode,
  WidgetPosition,
  WidgetStatus,
} from '@crm/contracts';
import type { WidgetRow } from './widgets.repository';

/** `<base>/widget/<token>/embed` and `/chat`: the two addresses a widget is reachable at. */
export interface WidgetUrls {
  embedUrl: string;
  previewUrl: string;
}

export const widgetUrls = (base: string, token: string): WidgetUrls => ({
  embedUrl: `${base}/widget/${token}/embed`,
  previewUrl: `${base}/widget/${token}/chat`,
});

export const toWidget = (row: WidgetRow, base: string): Widget => ({
  id: row.uuid,
  name: row.name,
  slug: row.slug,
  status: row.status as WidgetStatus,
  mode: row.mode as WidgetMode,
  assistantId: row.assistantUuid,
  targetWhatsappCc: row.targetWhatsappCc,
  targetWhatsappNumber: row.targetWhatsappNumber,
  prefilledMessage: row.prefilledMessage,
  position: row.position as WidgetPosition,
  buttonColor: row.buttonColor,
  buttonImageUrl: row.buttonImageUrl,
  headerTitle: row.headerTitle,
  headerBg: row.headerBg,
  headerTextColor: row.headerTextColor,
  welcomeMessage: row.welcomeMessage,
  messageBubbleColor: row.messageBubbleColor,
  messageTextColor: row.messageTextColor,
  bodyBgKind: row.bodyBgKind as 'color' | 'image',
  bodyBgColor: row.bodyBgColor,
  bodyBgImageUrl: row.bodyBgImageUrl,
  autoOpen: row.autoOpen,
  buttonLabel: row.buttonLabel,
  actionButtonBg: row.actionButtonBg,
  actionButtonTextColor: row.actionButtonTextColor,
  collectName: row.collectName,
  collectEmail: row.collectEmail,
  collectPhone: row.collectPhone,
  allowedDomains: row.allowedDomains,
  embedToken: row.embedToken,
  ...widgetUrls(base, row.embedToken),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  rowVersion: row.rowVersion,
});

export const toWidgetListItem = (row: WidgetRow, base: string): WidgetListItem => ({
  ...toWidget(row, base),
  assistant:
    row.assistantUuid && row.assistantName
      ? { id: row.assistantUuid, name: row.assistantName }
      : null,
  visitors: row.visitors,
});
