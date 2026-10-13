import {
  bulkConversationsResponseSchema,
  inboxLabelListSchema,
  inboxLabelSchema,
  channelListResponseSchema,
  channelResponseSchema,
  conversationEventListResponseSchema,
  conversationGroupMembersSchema,
  conversationListResponseSchema,
  conversationNoteSchema,
  conversationSummarySchema,
  inboxAssigneesResponseSchema,
  inboxConversationDetailSchema,
  inboxCountsSchema,
  inboxMediaUploadSchema,
  inboxTemplateListResponseSchema,
  markConversationReadResponseSchema,
  messageListResponseSchema,
  messageLogExportListSchema,
  messageLogExportSchema,
  messageLogResponseSchema,
  messageResponseSchema,
  pageResponseSchema,
  simulatorInboundResponseSchema,
} from '@crm/contracts';

/**
 * Everything the inbox screens parse with. Every shape comes from `@crm/contracts` (chat-conversations for the conversation, the
 * message and the channel; team-inbox-conversations for the detail, the timeline and attachments; team-inbox-routing-sla for
 * the assignee picker); this file only gathers the names the feature uses and adds the one envelope the contracts leave to the
 * caller (a page of notes).
 */

export {
  bulkConversationsResponseSchema,
  inboxLabelListSchema,
  inboxLabelSchema,
  channelListResponseSchema,
  channelResponseSchema,
  conversationEventListResponseSchema,
  conversationGroupMembersSchema,
  conversationListResponseSchema,
  conversationNoteSchema,
  conversationSummarySchema,
  inboxAssigneesResponseSchema,
  inboxConversationDetailSchema,
  inboxCountsSchema,
  inboxMediaUploadSchema,
  inboxTemplateListResponseSchema,
  markConversationReadResponseSchema,
  messageListResponseSchema,
  messageLogExportListSchema,
  messageLogExportSchema,
  messageLogResponseSchema,
  messageResponseSchema,
  simulatorInboundResponseSchema,
};

export const noteListSchema = pageResponseSchema(conversationNoteSchema);
