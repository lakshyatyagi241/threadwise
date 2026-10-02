# API: in-app notifications (the header bell)

Domain `notif` (WD-NOTIF-006, 012, 015, 017). Base path `/v2`. Errors are `application/problem+json` with a stable `code`. Shapes live in
`packages/contracts/src/notifications-activity-audit/`. Every id on the wire is a uuid.

Each person has their own feed (`inbox_notifications`, tenant-scoped with forced row level security). Every route needs a staff bearer token and
is pinned to the caller's own user id: nobody can read or mark another person's notification, and another workspace's is invisible. There is no
permission key (WaDesk had no role gate on the bell either); a non-staff actor is 403.

| Route                                        | Notes                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /notifications?limit&cursor&unreadOnly` | newest first, `limit` 1..50 (default 20), keyset `cursor` from `page.nextCursor`; `meta.unread` is the real unread total |
| `GET /notifications/unread-count`            | `{ "unread": 3 }` (the badge; the web app polls it once a minute)                                                        |
| `POST /notifications/:id/read`               | marks one read and returns it; idempotent (the first `readAt` is kept); someone else's or unknown id is 404              |
| `POST /notifications/read-all`               | `{ "updated": n }`, only the caller's unread rows                                                                        |

A notification: `{ id, type, title, body, link, data, readAt, createdAt }`. `type` is `task_assigned`, `task_due` or `task_completed` today; `data`
carries what a client needs to word it in the viewer's language (`taskId`, `taskTitle`, `dueAt`, `actorName`), `title` / `body` are the server's English
fallback, and `link` is an app path (`/tasks?task=<uuid>`), never an absolute URL.

## How rows get written

Outbox consumers, in the worker process. A consumer implements `OutboxSubscriber` (kernel, `kernel/outbox/outbox-subscribers.ts`), registers itself with the
`OutboxSubscriberRegistry`, and `OutboxDrainService` hands it each event of the types it asked for. Delivery is at-least-once, so a consumer must be
idempotent: the notification insert is `ON CONFLICT DO NOTHING` on `(org_id, user_id, dedupe_key)` where the key is the event type plus the outbox event id.
The task consumer and its rules are in [tasks.md](tasks.md#notifications).

## Not built here

The full `/notifications` page, per-person preferences (WD-NOTIF-005), email, Slack and Web Push delivery, the workspace feed (`notifications` table,
WD-NOTIF-001..004), and retention (the feed is never pruned yet).
