# Wiring: message delivery log, archive and export (platform addition)

Not a Reference feature: added because a message that Meta accepted and then refused (error 131049) looked `sent` after an agent pressed Retry, with no way to see why.
It adds no screen of Reference and changes none of its behaviour.

| Piece                         | Where                                                                                                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables                        | `message_event_archives`, `message_log_exports` (migration `20261116100000_message_log_archive`, RLS forced); `message_events` unchanged (+ `created_at` index)                                                                        |
| Permission                    | `inbox.logs.export` (workspace Admin preset); reading one message's log needs `inbox.conversation.read`                                                                                                                                |
| Contracts                     | `packages/contracts/src/chat-conversations/message-log.ts`; errors `MESSAGE_LOG_EXPORT_*`                                                                                                                                              |
| API                           | `modules/chat-conversations/message-log*.ts` (service, repository, rules, archive sweep, export runner/processor/publisher, `MESSAGE_LOG_FACADE`); routes in `team-inbox-conversations/inbox.controller.ts` (`InboxMessageLogService`) |
| Worker                        | `ChatConversationsWorkerModule`: `MessageLogArchiveService` (cron 02:17), `MessageLogExportProcessor` (queue `msg-log-export`)                                                                                                         |
| Web                           | `features/team-inbox-conversations`: `MessageLogDialog` (bubble list icon and the failure line), `MessageLogsScreen` at `/inbox/message-logs`, Settings tile `message-logs` (Data and security), help guide `message-logs`             |
| Retry fix                     | `OutboundService.retry` + `ChannelDispatcher.forget`; stale receipts ignored in `MessagesRepository.applyReceipt`                                                                                                                      |
| Consumers of the retry change | the inbox Retry button, `POST /inbox/messages/:id/retry`, the public API's message retry (same service)                                                                                                                                |
