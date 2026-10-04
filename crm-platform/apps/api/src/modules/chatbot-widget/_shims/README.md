# Shims

Stand-ins for services other domains own and have not built yet. Each is an interface (`tokens.ts`) plus a default
implementation. When the owning domain exports the real service, bind it to the same token in
`chatbot-widget.module.ts` and delete the shim.

| Shim                 | Default                 | Real owner (TW domain)                                                                              | Used by                   | Tracker row               |
| -------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------- |
| `AssistantDirectory` | `SqlAssistantDirectory` | ai-agents-training (AIAG): assistants and training sources                                          | TW-WGT-003, 006, 016      | blocked on AIAG (partial) |
| `InboxGateway`       | `SqlInboxGateway`       | team-inbox-conversations (TIB1) conversations and messages; contacts-attributes-tags (CON) contacts | TW-WGT-014, 015, 017, 018 | blocked on TIB1 (partial) |
| `AiChatPort` (infra) | `HttpAiChatAdapter`     | ai-keys-usage-admin (AIADM): workspace (BYOK) and platform provider keys, token metering            | TW-WGT-016                | keys from `WGT_AI_*` env  |

What the `SqlInboxGateway` stands in for, so the swap is complete:

- the widget's channel (kind `webchat`, one per widget, keyed by the widget uuid) and the visitor's thread on it (the visitor uuid is
  the peer key), and the visitor's contact;
- writing the visitor's line (`sender_kind = 'customer'`, status `received`), the opening line and the assistant's reply
  (`sender_kind = 'bot'`) into `messages`, taking the next `conversations.msg_seq` for each;
- the engine stamped on the thread is not a shim concern any more (the thread belongs to the widget's own `webchat` channel);
- the human-takeover read (ANY outbound line after the opening line counts, as Reference: QUIRK, so the assistant answers the first
  message only), and the oldest-200 transcript read.

`LanguageHint` is not a shim any more: `LANGUAGE_HINT` is bound to the I18N `ConversationTranslationService.replyLanguage`.

The plan gate is not a shim any more: `widget-plan.ts` binds the `chatbot_widgets` flag of the plan catalogue through the entitlement service.

The team inbox screens, the inbox reply path and the mobile list belong to TIB1; the widget side of that hand-off
(TW-WGT-018, 019) is the polling contract tested in `test/e2e/chatbot-widget`.
