# Shims

Stand-ins for services other domains own and have not built yet. Each is an interface (`tokens.ts`) plus a default
implementation. When the owning domain exports the real service, bind it to the same token in
`chatbot-widget.module.ts` and delete the shim.

| Shim                 | Default                 | Real owner (TW domain)                                                                              | Used by                   | Tracker row               |
| -------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------- |
| `AssistantDirectory` | `SqlAssistantDirectory` | ai-agents-training (AIAG): assistants and training sources                                          | TW-WGT-003, 006, 016      | blocked on AIAG (partial) |
| `InboxGateway`       | `SqlInboxGateway`       | team-inbox-conversations (TIB1) conversations and messages; contacts-attributes-tags (CON) contacts | TW-WGT-014, 015, 017, 018 | blocked on TIB1 (partial) |
| `WidgetPlanGate`     | `OpenWidgetPlanGate`    | plans-subscriptions-trials (PLAN): the `access_chatbot_widgets` flag is not in the catalogue yet    | TW-WGT-027                | blocked on PLAN           |
| `LanguageHint`       | `NoLanguageHint`        | localization-translation (I18N): real-time translation config and language detection                | TW-WGT-016                | blocked on I18N           |
| `AiChatPort` (infra) | `HttpAiChatAdapter`     | ai-keys-usage-admin (AIADM): workspace (BYOK) and platform provider keys, token metering            | TW-WGT-016                | keys from `WGT_AI_*` env  |

What the `SqlInboxGateway` stands in for, so the swap is complete:

- the widget's channel (kind `webchat`, one per widget, keyed by the widget uuid) and the visitor's thread on it (the visitor uuid is
  the peer key), and the visitor's contact;
- writing the visitor's line (`sender_kind = 'customer'`, status `received`) and the assistant's reply (`sender_kind = 'bot'`) into
  `messages`, taking the next `conversations.msg_seq` for each;
- the human-takeover read (an outbound line with `sender_kind = 'agent'`).

The team inbox screens, the inbox reply path and the mobile list belong to TIB1; the widget side of that hand-off
(TW-WGT-018, 019) is the polling contract tested in `test/e2e/chatbot-widget`.
