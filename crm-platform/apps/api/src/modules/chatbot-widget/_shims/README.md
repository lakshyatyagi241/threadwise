# Shims

Stand-ins for services other domains own and have not built yet. Each is an interface (`tokens.ts`) plus a default
implementation. When the owning domain exports the real service, bind it to the same token in
`chatbot-widget.module.ts` and delete the shim.

| Shim                 | Default                 | Real owner (WD domain)                                                                              | Used by                   | Tracker row               |
| -------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------- |
| `AssistantDirectory` | `SqlAssistantDirectory` | ai-agents-training (AIAG): assistants and training sources                                          | WD-WGT-003, 006, 016      | blocked on AIAG (partial) |
| `InboxGateway`       | `SqlInboxGateway`       | team-inbox-conversations (TIB1) conversations and messages; contacts-attributes-tags (CON) contacts | WD-WGT-014, 015, 017, 018 | blocked on TIB1 (partial) |
| `LanguageHint`       | `NoLanguageHint`        | localization-translation (I18N): real-time translation config and language detection                | WD-WGT-016                | blocked on I18N           |
| `AiChatPort` (infra) | `HttpAiChatAdapter`     | ai-keys-usage-admin (AIADM): workspace (BYOK) and platform provider keys, token metering            | WD-WGT-016                | keys from `WGT_AI_*` env  |

What the `SqlInboxGateway` stands in for, so the swap is complete:

- creating the conversation (`channel = 'chatbot_widget'`, `origin = 'web'`) and its contact;
- writing the visitor's line and the assistant's reply into `inbox_messages`;
- the engine stamped on the thread (the workspace's primary WhatsApp engine; fixed to `baileys`, WaDesk's fallback, until
  WADEV exports it);
- the human-takeover read (ANY outbound line counts, as WaDesk: QUIRK, so the assistant answers the first message only);
- the opening line, written to the legacy `messages` table (QUIRK), and the oldest-200 transcript read.

The plan gate is not a shim any more: `widget-plan.ts` binds the `chatbot_widgets` flag of the plan catalogue through the entitlement service.

The team inbox screens, the inbox reply path and the mobile list belong to TIB1; the widget side of that hand-off
(WD-WGT-018, 019) is the polling contract tested in `test/e2e/chatbot-widget`.
